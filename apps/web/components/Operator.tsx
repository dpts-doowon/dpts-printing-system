"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ATTEMPT_STATE_PT, JOB_STATUS_PT } from "@doowon/shared";
import { ApiError, api, newKey } from "../lib/api";
import type { AttemptSummary, JobSummary, OperatorContext } from "../lib/types";
import { Logo } from "./Brand";
import { LabelPreview } from "./LabelPreview";

type Stage = "select" | "print" | "check" | "continue" | "end";
type Msg = { kind: "err" | "warn" | "ok"; text: string } | null;

const PRINTER_BADGE: Record<string, [string, string]> = {
  READY: ["Impressora pronta", "ok"],
  UNAVAILABLE: ["Impressora indisponível", "bad"],
  UNKNOWN: ["Status da impressora desconhecido", "warn"],
  OFFLINE: ["Estação sem conexão", "bad"],
};
const STEPS: [Stage, string][] = [
  ["select", "Seleção"],
  ["print", "Impressão"],
  ["check", "Conferência"],
];
/** Títulos na tela do operador: ele mesmo decide como recomeçar (a regra de quem decide é a D-031). */
const OPERATOR_STATUS_PT: Record<string, string> = {
  REQUIRES_REVIEW: "Conferir a etiqueta",
  AWAITING_DECISION: "Impressão interrompida",
};

const REASONS = ["Etiqueta danificada", "Etiqueta perdida", "Outro motivo"];

export function Operator({
  name,
  onLogout,
  onExpired,
}: {
  name: string;
  onLogout: () => void;
  onExpired: () => void;
}) {
  const [ctx, setCtx] = useState<OperatorContext | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [partId, setPartId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [lastJob, setLastJob] = useState<JobSummary | null>(null);
  const pendingKey = useRef<{ sig: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const c = await api<OperatorContext>("GET", "/operator/context");
      setCtx(c);
      setMachineId((m) => m || (c.fixedMachine ? (c.machines[0]?.id ?? "") : ""));
      if (c.activeJob) {
        setLastJob(c.activeJob);
        // Recarregou a página com um pedido em andamento: volta para a impressão.
        setPartId((p) => p || c.parts[0]?.id || "");
        setMachineId((m) => m || c.machines[0]?.id || "");
        setStage((s) => (s === "select" ? "print" : s));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired();
    }
  }, [onExpired]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // Ao terminar o pedido, busca o resultado final e passa para a conferência.
  const activeId = ctx?.activeJob?.printJobId;
  useEffect(() => {
    if (!lastJob || activeId) return;
    void api<JobSummary>("GET", `/operator/print-jobs/${lastJob.printJobId}`)
      .then((j) => {
        setLastJob(j);
        // Só avança quando o pedido terminou; enquanto imprime, o contexto ainda vai refletir.
        if (["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(j.status))
          setStage((s) => (s === "print" ? "check" : s));
      })
      .catch(() => undefined);
  }, [activeId, lastJob?.printJobId]);

  if (!ctx)
    return (
      <main className="op">
        <p>Carregando…</p>
      </main>
    );

  const part = ctx.parts.find((p) => p.id === partId);
  const machine = ctx.machines.find((m) => m.id === machineId);
  const [printerLabel, printerClass] =
    PRINTER_BADGE[ctx.printer.status] ?? PRINTER_BADGE["UNKNOWN"]!;
  const active = ctx.activeJob;

  const run = async (fn: () => Promise<unknown>, okText?: string): Promise<boolean> => {
    try {
      await fn();
      if (okText) setMessage({ kind: "ok", text: okText });
      await refresh();
      return true;
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof ApiError ? e.message : "Ocorreu um erro." });
      return false;
    }
  };

  const print = async (quantity: number): Promise<void> => {
    setMessage(null);
    setSending(true);
    // A chave de idempotência é reutilizada enquanto o resultado do pedido não for conhecido.
    const sig = `${partId}|${machineId}|${quantity}`;
    if (pendingKey.current?.sig !== sig) pendingKey.current = { sig, key: newKey() };
    try {
      const job = await api<JobSummary>("POST", "/operator/print-jobs", {
        partId,
        machineId,
        quantity,
        idempotencyKey: pendingKey.current.key,
      });
      pendingKey.current = null;
      setLastJob(job);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status !== 0) pendingKey.current = null;
        setMessage({ kind: e.code === "PRINTER_BUSY" ? "warn" : "err", text: e.message });
        if (e.status === 401) onExpired();
      }
    } finally {
      setSending(false);
    }
  };

  const newSelection = (): void => {
    setMessage(null);
    setLastJob(null);
    setPartId("");
    if (!ctx.fixedMachine) setMachineId("");
    setStage("select");
  };

  const idx = STEPS.findIndex(([s]) => s === stage);
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Logo />
          <div className="grow">
            <b>{ctx.station.name}</b>
            <div className="small" style={{ color: "#dbe0ff" }}>
              Operador: {name} · Turno: {ctx.shift?.name ?? "sem turno vigente"}
            </div>
          </div>
          <span className={`badge ${printerClass}`}>{printerLabel}</span>
          <button onClick={onLogout}>Sair</button>
        </div>
      </header>
      <main className="op">
        {stage !== "end" && (
          <nav className="steps" aria-label="Etapas">
            {STEPS.map(([s, label], i) => (
              <span key={s} style={{ display: "contents" }}>
                {i > 0 && <span className="step-line" />}
                <span className={`step${i < idx ? " done" : ""}${i === idx ? " cur" : ""}`}>
                  <i>{i < idx ? "✓" : i + 1}</i>
                  {label}
                </span>
              </span>
            ))}
          </nav>
        )}

        {message && (
          <div className={`msg ${message.kind}`} role="alert">
            {message.text}
          </div>
        )}

        {stage === "select" && (
          <>
            <div className="card">
              <h2>Selecione a máquina</h2>
              {ctx.fixedMachine && (
                <p className="small">Este posto está vinculado a uma única máquina.</p>
              )}
              <div className="pick">
                {ctx.machines.map((m) => (
                  <button
                    key={m.id}
                    className={m.id === machineId ? "sel" : ""}
                    disabled={ctx.fixedMachine && m.id !== machineId}
                    onClick={() => setMachineId(m.id)}
                  >
                    <span className="t">{m.name}</span>
                    <span className="s">{m.code}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <h2>Selecione a peça / modelo</h2>
              <div className="pick">
                {ctx.parts.map((p) => (
                  <button
                    key={p.id}
                    className={p.id === partId ? "sel" : ""}
                    onClick={() => setPartId(p.id)}
                  >
                    <span className="t">{p.description}</span>
                    <span className="s">PN {p.partNumber}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="cta"
              disabled={!part || !machine}
              onClick={() => {
                setMessage(null);
                setStage("print");
              }}
            >
              Continuar
            </button>
          </>
        )}

        {stage === "print" && (
          <PrintStage
            ctx={ctx}
            partLabel={part ? `${part.description} — ${part.partNumber}` : ""}
            machineName={machine?.name ?? ""}
            sending={sending}
            print={print}
            job={active}
            run={run}
            onBack={() => setStage("select")}
            onAdjust={async () => {
              const ok = await run(
                () => api("POST", "/operator/adjustment-requests", { partId, machineId }),
                "Pedido de ajuste enviado ao administrador.",
              );
              if (ok) setStage("select");
            }}
          />
        )}

        {stage === "check" && lastJob && (
          <CheckStage
            job={lastJob}
            run={run}
            onDone={() => setStage("continue")}
            onBack={() => setStage("print")}
          />
        )}

        {stage === "continue" && (
          <div className="card">
            <h2>Continuar produção?</h2>
            <p className="small">Você pode imprimir mais etiquetas com a mesma seleção.</p>
            <div className="row">
              <button className="cta success" onClick={() => setStage("print")}>
                Sim, continuar
              </button>
              <button className="cta secondary" onClick={() => setStage("end")}>
                Não, encerrar
              </button>
            </div>
          </div>
        )}

        {stage === "end" && (
          <div className="card">
            <h2>Produção encerrada</h2>
            <p>Nenhuma etiqueta pendente. Você pode iniciar uma nova seleção ou sair.</p>
            <div className="row">
              <button onClick={newSelection}>Nova seleção</button>
              <button className="secondary" onClick={onLogout}>
                Encerrar turno e sair
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function PrintStage({
  ctx,
  partLabel,
  machineName,
  sending,
  print,
  job,
  run,
  onBack,
  onAdjust,
}: {
  ctx: OperatorContext;
  partLabel: string;
  machineName: string;
  sending: boolean;
  print: (q: number) => Promise<void>;
  job: JobSummary | null;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
  onBack: () => void;
  onAdjust: () => Promise<void>;
}) {
  const canPrint = !job && !sending && ctx.printer.status === "READY" && !!ctx.shift;
  const printerOk = ctx.printer.status === "READY";
  return (
    <div className="two">
      <div className="card">
        <h2>Resumo da operação</h2>
        <div className="kv">
          <span>Máquina</span>
          <span>{machineName}</span>
        </div>
        <div className="kv">
          <span>Peça</span>
          <span>{partLabel}</span>
        </div>
        <div className="kv">
          <span>Turno</span>
          <span>{ctx.shift?.name ?? "—"}</span>
        </div>
        {!job && (
          <p>
            <button className="link" onClick={() => void onAdjust()}>
              Dados incorretos? Solicitar ajuste
            </button>
            <button className="link" onClick={onBack}>
              Voltar
            </button>
          </p>
        )}
      </div>
      <div>
        <div className={`printer-ok${printerOk ? "" : " bad"}`}>
          <span className="dot" />
          <div>
            <b>{ctx.printer.name ?? "Impressora"}</b>
            <div className="small">
              {printerOk ? "Pronta para imprimir" : "Indisponível no momento"}
            </div>
          </div>
        </div>
        {!job && (
          <div className="print-btns">
            {ctx.quantities.map((q) => (
              <button key={q} disabled={!canPrint} onClick={() => void print(q)}>
                <b>{q}</b>
                {sending ? "Enviando…" : `etiqueta${q > 1 ? "s" : ""}`}
              </button>
            ))}
          </div>
        )}
        {job && <ActiveJob job={job} run={run} />}
      </div>
    </div>
  );
}

function ActiveJob({
  job,
  run,
}: {
  job: JobSummary;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}) {
  const total = job.attempts.length;
  const done = job.attempts.filter((a) => a.state === "PRINTED_CONFIRMED").length;
  const unknown = job.attempts.find((a) => a.state === "UNKNOWN_OUTCOME");
  const unknownCount = job.attempts.filter((a) => a.state === "UNKNOWN_OUTCOME").length;
  const stopped = job.attempts.find((a) => a.state === "FAILED" || a.state === "UNKNOWN_OUTCOME");
  return (
    <div className="card">
      <h2>{OPERATOR_STATUS_PT[job.status] ?? JOB_STATUS_PT[job.status] ?? job.status}</h2>
      <Cells job={job} />
      {job.status === "IN_PROGRESS" && (
        <p>
          Imprimindo: {done} de {total} etiquetas confirmadas.
        </p>
      )}
      {job.status === "REQUIRES_REVIEW" && (
        <div className="msg err" role="alert">
          Não foi possível confirmar a impressão{" "}
          {unknownCount > 1 ? `de ${unknownCount} etiquetas` : `da etiqueta ${unknown?.sequence}`}.
          Confira na impressora e informe abaixo o que aconteceu.
        </div>
      )}
      {job.status === "AWAITING_DECISION" && (
        <div className="msg warn" role="alert">
          A impressão parou na etiqueta {stopped?.sequence} de {total}. Verifique o papel e a
          impressora antes de continuar.
        </div>
      )}
      {(job.status === "REQUIRES_REVIEW" || job.status === "AWAITING_DECISION") && (
        <Restart job={job} run={run} />
      )}
      {job.status === "IN_PROGRESS" && (
        <p>
          <button
            className="secondary"
            onClick={() =>
              void run(() => api("POST", `/operator/print-jobs/${job.printJobId}/cancel`))
            }
          >
            Cancelar o restante
          </button>
        </p>
      )}
    </div>
  );
}

function Restart({
  job,
  run,
}: {
  job: JobSummary;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}) {
  type Outcome = "" | "PRINTED" | "NOT_PRINTED";
  const unknowns = job.attempts.filter((a) => a.state === "UNKNOWN_OUTCOME");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [all, setAll] = useState(false);
  const [reason, setReason] = useState("Papel acabou ou impressão falhou");
  const answered = (a: AttemptSummary): Outcome => outcomes[a.attemptId] ?? "";
  const done =
    job.attempts.filter((a) => a.state === "PRINTED_CONFIRMED").length +
    unknowns.filter((a) => answered(a) === "PRINTED").length;
  const pending = job.attempts.length - done;
  const needsOutcome = unknowns.some((a) => answered(a) === "");
  const setAllTo = (v: Outcome): void =>
    setOutcomes(Object.fromEntries(unknowns.map((a) => [a.attemptId, v])));
  const restart = (mode: "RESUME" | "ALL") =>
    void run(
      () =>
        api("POST", `/operator/print-jobs/${job.printJobId}/restart`, {
          idempotencyKey: newKey(),
          mode,
          ...(unknowns.length > 0
            ? {
                unknownOutcomes: Object.fromEntries(
                  unknowns.map((a) => [a.attemptId, answered(a)]),
                ),
              }
            : {}),
          ...(mode === "ALL" ? { reason } : {}),
        }),
      mode === "RESUME" ? "Impressão retomada." : "Reimpressão de todas as etiquetas iniciada.",
    );
  return (
    <div className="big-actions">
      {unknowns.length > 0 && (
        <>
          <p className="small">
            {unknowns.length === 1
              ? `A etiqueta ${unknowns[0]!.sequence} saiu impressa e legível?`
              : "Confira as etiquetas da última linha e informe quais saíram impressas e legíveis:"}
          </p>
          {unknowns.length > 1 && (
            <p className="row">
              <button className="secondary" onClick={() => setAllTo("PRINTED")}>
                Todas saíram
              </button>
              <button className="secondary" onClick={() => setAllTo("NOT_PRINTED")}>
                Nenhuma saiu
              </button>
            </p>
          )}
          {unknowns.map((a) => (
            <div key={a.attemptId} className="row">
              <label htmlFor={`o-${a.attemptId}`}>Etiqueta {a.sequence}</label>
              <select
                id={`o-${a.attemptId}`}
                value={answered(a)}
                onChange={(e) =>
                  setOutcomes({ ...outcomes, [a.attemptId]: e.target.value as Outcome })
                }
              >
                <option value="">Selecione…</option>
                <option value="PRINTED">Saiu correta</option>
                <option value="NOT_PRINTED">Não saiu ou saiu com defeito</option>
              </select>
            </div>
          ))}
        </>
      )}
      {!all ? (
        <>
          <button disabled={needsOutcome} onClick={() => restart("RESUME")}>
            Continuar de onde parou
            <small>
              Mantém as {done} já impressas e imprime as {pending} restantes.
            </small>
          </button>
          <button className="secondary" disabled={needsOutcome} onClick={() => setAll(true)}>
            Reimprimir tudo
            <small>Imprime novamente todas as {job.attempts.length} etiquetas do pedido.</small>
          </button>
        </>
      ) : (
        <>
          <label htmlFor="restart-reason">Motivo da reimpressão</label>
          <input id="restart-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="row">
            <button disabled={reason.trim() === ""} onClick={() => restart("ALL")}>
              Confirmar reimpressão de tudo
            </button>
            <button className="secondary" onClick={() => setAll(false)}>
              Voltar
            </button>
          </p>
        </>
      )}
    </div>
  );
}

function Cells({
  job,
  selected,
  onPick,
}: {
  job: JobSummary;
  selected?: string;
  onPick?: (a: AttemptSummary) => void;
}) {
  return (
    <div className="cells" aria-label="Situação de cada etiqueta">
      {job.attempts.map((a) => {
        const pickable = !!onPick && a.state === "PRINTED_CONFIRMED";
        return (
          <div
            key={a.attemptId}
            className={`cell ${a.state}${a.held ? " held" : ""}${pickable ? " pickable" : ""}${
              selected === a.attemptId ? " sel" : ""
            }`}
            title={ATTEMPT_STATE_PT[a.state]}
            onClick={pickable ? () => onPick(a) : undefined}
          >
            {a.sequence}
          </div>
        );
      })}
    </div>
  );
}

function CheckStage({
  job,
  run,
  onDone,
  onBack,
}: {
  job: JobSummary;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
  onDone: () => void;
  onBack: () => void;
}) {
  const printed = job.attempts.filter((a) => a.state === "PRINTED_CONFIRMED");
  const [pickId, setPickId] = useState<string>("");
  const [reprint, setReprint] = useState(false);
  const [reason, setReason] = useState(REASONS[0]!);
  const [detail, setDetail] = useState("");
  const current = printed.find((a) => a.attemptId === pickId) ?? printed[printed.length - 1];

  if (!current)
    return (
      <div className="card">
        <h2>Nenhuma etiqueta confirmada</h2>
        <p>Este pedido terminou sem etiquetas impressas. {JOB_STATUS_PT[job.status] ?? ""}</p>
        <button onClick={onBack}>Voltar</button>
      </div>
    );

  return (
    <div className="two">
      <div className="card">
        <div className="msg ok">
          Etiqueta impressa! Quantidade {printed.length} de {job.quantity}
        </div>
        <p className="small">Toque em um número para conferir outra etiqueta.</p>
        <Cells job={job} selected={current.attemptId} onPick={(a) => setPickId(a.attemptId)} />
        <LabelPreview label={current.label} />
      </div>
      <div className="card big-actions">
        <h2>Etiqueta OK?</h2>
        {!reprint ? (
          <>
            <button
              className="success"
              onClick={() =>
                void run(() =>
                  api("POST", `/operator/print-jobs/${job.printJobId}/acknowledge`),
                ).then((ok) => ok && onDone())
              }
            >
              Aplicar etiqueta
              <small>A etiqueta está correta e será aplicada na peça.</small>
            </button>
            <button className="danger" onClick={() => setReprint(true)}>
              Reimprimir
              <small>A etiqueta está danificada ou incorreta.</small>
            </button>
          </>
        ) : (
          <>
            <label htmlFor="reason">Motivo da reimpressão</label>
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {reason === "Outro motivo" && (
              <>
                <label htmlFor="detail">Descreva</label>
                <input id="detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
              </>
            )}
            <p className="row">
              <button
                disabled={reason === "Outro motivo" && detail.trim() === ""}
                onClick={() =>
                  void run(
                    () =>
                      api("POST", `/operator/labels/${current.labelId}/reprint`, {
                        idempotencyKey: newKey(),
                        reason: reason === "Outro motivo" ? detail : reason,
                      }),
                    "Reimpressão solicitada.",
                  ).then((ok) => {
                    if (ok) {
                      setReprint(false);
                      onBack();
                    }
                  })
                }
              >
                Confirmar reimpressão
              </button>
              <button className="secondary" onClick={() => setReprint(false)}>
                Voltar
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
