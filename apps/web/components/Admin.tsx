"use client";

import { useCallback, useEffect, useState } from "react";
import { ATTEMPT_STATE_PT, JOB_STATUS_PT } from "@doowon/shared";
import { ApiError, api, download, newKey } from "../lib/api";
import type { JobSummary } from "../lib/types";
import { Logo } from "./Brand";

type Tab = "painel" | "maquinas" | "operadores" | "pecas" | "turnos" | "historico" | "auditoria";
const TABS: [Tab, string][] = [
  ["painel", "Dashboard"],
  ["maquinas", "Máquinas"],
  ["operadores", "Operadores"],
  ["pecas", "Peças / Modelos"],
  ["turnos", "Turnos"],
  ["historico", "Histórico"],
  ["auditoria", "Auditoria"],
];

export function Admin({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("painel");
  return (
    <div className="shell">
      <aside className="side">
        <Logo />
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="small" style={{ color: "#dbe0ff", padding: "0 12px" }}>
          {name}
        </div>
        <button onClick={onLogout}>Sair</button>
      </aside>
      <div className="content">
        {tab === "painel" && <Dashboard go={setTab} />}
        {tab === "maquinas" && (
          <Master
            kind="machines"
            title="Máquinas"
            fields={[
              ["code", "Código"],
              ["name", "Nome"],
            ]}
          />
        )}
        {tab === "operadores" && (
          <Master
            kind="operators"
            title="Operadores"
            fields={[
              ["username", "Usuário"],
              ["displayName", "Nome"],
              ["password", "Senha (mín. 8)"],
            ]}
            secret="password"
          />
        )}
        {tab === "pecas" && (
          <Master
            kind="parts"
            title="Peças / Modelos"
            fields={[
              ["description", "Descrição (2 letras + 3 números; vazio = usa o ALC)"],
              ["alcCode", "ALC Code (ex.: AG10)"],
              ["partNumber", "Part Number"],
            ]}
          />
        )}
        {tab === "turnos" && (
          <Master
            kind="shifts"
            title="Turnos"
            fields={[
              ["name", "Nome"],
              ["start", "Início (HH:MM)"],
              ["end", "Fim (HH:MM)"],
            ]}
          />
        )}
        {tab === "historico" && <History />}
        {tab === "auditoria" && <Audit />}
      </div>
    </div>
  );
}

interface StationCard {
  station: { id: string; name: string };
  printer: { name?: string; status: string };
  agent: { version: string; lastHeartbeatAt: number } | null;
  activeJob: JobSummary | null;
}
interface DashboardData {
  today: { date: string; shift: { name: string; start: string; end: string } | null };
  kpis: {
    labelsToday: number;
    labelsYesterday: number;
    reprintsToday: number;
    reprintsYesterday: number;
    machines: { active: number; total: number };
    operators: { active: number; total: number };
  };
  hourly: { hour: number; count: number }[];
  recent: { labelId: string; part: string; operator: string; at: number; machine: string }[];
  adjustments: { at: number; operator: string; station: string; note: string }[];
  stations: StationCard[];
}

function Delta({ now, before }: { now: number; before: number }) {
  const d = now - before;
  if (d === 0) return <span className="small">igual a ontem</span>;
  return (
    <span className={d > 0 ? "up" : "down"}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)} em relação a ontem
    </span>
  );
}

function Dashboard({ go }: { go: (t: Tab) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<DashboardData>("GET", "/admin/dashboard"));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Erro");
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setMsg("");
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Erro");
    }
  };

  if (!data) return <p>{msg || "Carregando…"}</p>;
  const k = data.kpis;
  const max = Math.max(1, ...data.hourly.map((h) => h.count));
  return (
    <>
      <div className="head">
        <h1 className="grow">Dashboard</h1>
        <span className="badge ok">
          {data.today.date} · Turno {data.today.shift?.name ?? "sem turno vigente"}
        </span>
      </div>
      {msg && (
        <div className="msg err" role="alert">
          {msg}
        </div>
      )}
      <div className="kpis">
        <div className="kpi">
          <div className="t">Etiquetas hoje</div>
          <div className="n">{k.labelsToday}</div>
          <Delta now={k.labelsToday} before={k.labelsYesterday} />
        </div>
        <div className="kpi">
          <div className="t">Reimpressões hoje</div>
          <div className="n">{k.reprintsToday}</div>
          <Delta now={k.reprintsToday} before={k.reprintsYesterday} />
        </div>
        <div className="kpi">
          <div className="t">Máquinas ativas</div>
          <div className="n">
            {k.machines.active}
            <span className="small"> / {k.machines.total}</span>
          </div>
        </div>
        <div className="kpi">
          <div className="t">Operadores ativos</div>
          <div className="n">
            {k.operators.active}
            <span className="small"> / {k.operators.total}</span>
          </div>
        </div>
      </div>

      <h2>Ações rápidas</h2>
      <div className="quick">
        <button onClick={() => go("historico")}>
          <b>Consultar histórico</b>
          <small>Buscar etiquetas e ver a rastreabilidade</small>
        </button>
        <button onClick={() => go("maquinas")}>
          <b>Cadastrar máquina</b>
          <small>Máquinas da linha</small>
        </button>
        <button onClick={() => go("operadores")}>
          <b>Cadastrar operador</b>
          <small>Acesso dos operadores</small>
        </button>
        <button onClick={() => go("pecas")}>
          <b>Cadastrar peça / modelo</b>
          <small>Descrição e Part Number</small>
        </button>
      </div>

      <div className="cols">
        <div className="card">
          <h3>Etiquetas por hora (últimas 24 h)</h3>
          <div className="bars" role="img" aria-label="Etiquetas impressas por hora">
            {data.hourly.map((h, i) => (
              <div
                key={i}
                style={{ height: `${(h.count / max) * 100}%` }}
                title={`${String(h.hour).padStart(2, "0")}h: ${h.count}`}
              />
            ))}
          </div>
          <div className="bars-x">
            {data.hourly.map((h, i) => (
              <span key={i}>{i % 3 === 0 ? h.hour : ""}</span>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Últimas impressões</h3>
          {data.recent.length === 0 ? (
            <p className="small">Nenhuma impressão ainda.</p>
          ) : (
            <table>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.labelId}>
                    <td>
                      <b>{r.part}</b>
                      <div className="small">
                        {r.operator} · {r.machine}
                      </div>
                    </td>
                    <td className="small">
                      {new Date(r.at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Solicitações de ajuste de dados</h3>
        {data.adjustments.length === 0 ? (
          <p className="small">Nenhuma solicitação.</p>
        ) : (
          <table>
            <tbody>
              {data.adjustments.map((a, i) => (
                <tr key={i}>
                  <td>{new Date(a.at).toLocaleString("pt-BR")}</td>
                  <td>{a.operator}</td>
                  <td>{a.station}</td>
                  <td>{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Postos</h2>
      {data.stations.map((s) => (
        <div className="card" key={s.station.id}>
          <div className="row">
            <h3 className="grow">{s.station.name}</h3>
            <span className={`badge ${s.printer.status === "READY" ? "ok" : "bad"}`}>
              {s.printer.name}:{" "}
              {s.printer.status === "READY"
                ? "pronta"
                : s.printer.status === "OFFLINE"
                  ? "sem conexão"
                  : "indisponível"}
            </span>
          </div>
          <div className="small">
            Agente: {s.agent ? `versão ${s.agent.version}` : "nunca conectou"}
          </div>
          {s.activeJob ? (
            <ActiveJobAdmin job={s.activeJob} act={act} />
          ) : (
            <p>Sem impressão em andamento.</p>
          )}
        </div>
      ))}
    </>
  );
}

function ActiveJobAdmin({
  job,
  act,
}: {
  job: JobSummary;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const unknown = job.attempts.find((a) => a.state === "UNKNOWN_OUTCOME");
  return (
    <div>
      <h3>
        {JOB_STATUS_PT[job.status] ?? job.status} ({job.counts["PRINTED_CONFIRMED"] ?? 0} de{" "}
        {job.quantity} confirmadas)
      </h3>
      <div className="cells">
        {job.attempts.map((a) => (
          <div
            key={a.attemptId}
            className={`cell ${a.state}${a.held ? " held" : ""}`}
            title={ATTEMPT_STATE_PT[a.state]}
          >
            {a.sequence}
          </div>
        ))}
      </div>
      {unknown && (
        <div className="msg err">
          <p>
            Etiqueta {unknown.sequence}: resultado desconhecido. Confira a impressora e a saída
            física.
          </p>
          <label htmlFor="note">Observação (obrigatória)</label>
          <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="row">
            <button
              disabled={!note.trim()}
              onClick={() =>
                void act(() =>
                  api("POST", `/admin/attempts/${unknown.attemptId}/resolve`, {
                    outcome: "PRINTED",
                    note,
                  }),
                )
              }
            >
              A etiqueta saiu
            </button>
            <button
              className="danger"
              disabled={!note.trim()}
              onClick={() =>
                void act(() =>
                  api("POST", `/admin/attempts/${unknown.attemptId}/resolve`, {
                    outcome: "NOT_PRINTED",
                    note,
                  }),
                )
              }
            >
              A etiqueta não saiu
            </button>
          </p>
        </div>
      )}
      {job.status === "AWAITING_DECISION" && (
        <div className="msg warn">
          <p>Impressão parada. Decida o que fazer com as etiquetas restantes.</p>
          <p className="row">
            <button
              onClick={() =>
                void act(() =>
                  api("POST", `/admin/print-jobs/${job.printJobId}/held`, { decision: "CONTINUE" }),
                )
              }
            >
              Continuar
            </button>
            <button
              className="secondary"
              onClick={() =>
                void act(() =>
                  api("POST", `/admin/print-jobs/${job.printJobId}/held`, { decision: "CANCEL" }),
                )
              }
            >
              Cancelar o restante
            </button>
          </p>
        </div>
      )}
      {job.attempts.some((a) => a.state === "FAILED") && job.status !== "REQUIRES_REVIEW" && (
        <p className="row">
          {job.attempts
            .filter((a) => a.state === "FAILED")
            .map((a) => (
              <button
                key={a.attemptId}
                className="secondary"
                onClick={() =>
                  void act(() =>
                    api("POST", `/admin/labels/${a.labelId}/retry`, { idempotencyKey: newKey() }),
                  )
                }
              >
                Nova tentativa da etiqueta {a.sequence}
              </button>
            ))}
        </p>
      )}
    </div>
  );
}

function Master({
  kind,
  title,
  fields,
  secret,
}: {
  kind: string;
  title: string;
  fields: [string, string][];
  secret?: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setRows(await api<Record<string, unknown>[]>("GET", `/admin/${kind}`));
  }, [kind]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setMsg("");
    try {
      await fn();
      setForm({});
      setEditId(null);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Erro");
    }
  };
  const startEdit = (r: Record<string, unknown>): void => {
    setEditId(String(r["id"]));
    setForm(
      Object.fromEntries(
        fields.filter(([k]) => k !== secret).map(([k]) => [k, String(r[k] ?? "")]),
      ),
    );
  };
  const save = (): Promise<void> => {
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
    return act(() =>
      editId ? api("PUT", `/admin/${kind}/${editId}`, body) : api("POST", `/admin/${kind}`, form),
    );
  };

  return (
    <>
      <div className="head">
        <h1 className="grow">{title}</h1>
      </div>
      {msg && (
        <div className="msg err" role="alert">
          {msg}
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr>
              {fields
                .filter(([k]) => k !== secret)
                .map(([k, l]) => (
                  <th key={k}>{l}</th>
                ))}
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r["id"])}>
                {fields
                  .filter(([k]) => k !== secret)
                  .map(([k]) => (
                    <td key={k}>{String(r[k] ?? "")}</td>
                  ))}
                <td>
                  <span className={`badge ${r["active"] ? "ok" : "warn"}`}>
                    {r["active"] ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <div className="row">
                    <button className="secondary" onClick={() => startEdit(r)}>
                      Editar
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void act(() =>
                          api("PUT", `/admin/${kind}/${r["id"]}/active`, { active: !r["active"] }),
                        )
                      }
                    >
                      {r["active"] ? "Inativar" : "Reativar"}
                    </button>
                    <button
                      className="danger"
                      onClick={() => void act(() => api("DELETE", `/admin/${kind}/${r["id"]}`))}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">Cadastros com histórico não podem ser excluídos; inative-os.</p>
      </div>
      <div className="card">
        <h3>{editId ? "Editar cadastro" : "Novo cadastro"}</h3>
        <div className="row">
          {fields.map(([k, l]) => (
            <div className="grow" key={k}>
              <label htmlFor={`f-${k}`}>
                {k === secret && editId ? `${l} — deixe em branco para manter` : l}
              </label>
              <input
                id={`f-${k}`}
                type={k === secret ? "password" : "text"}
                value={form[k] ?? ""}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <p className="row">
          <button onClick={() => void save()}>{editId ? "Salvar" : "Adicionar"}</button>
          {editId && (
            <button
              className="secondary"
              onClick={() => {
                setEditId(null);
                setForm({});
              }}
            >
              Cancelar edição
            </button>
          )}
        </p>
      </div>
    </>
  );
}

interface HistoryRow {
  labelId: string;
  partDescription: string;
  partNumber: string;
  operator: string;
  machine: string;
  shift: string;
  producedAtUtc: string;
  lastState: string;
  attempts: number;
  reprints: number;
}
interface Option {
  id: string;
  name?: string;
  displayName?: string;
  code?: string;
}
const EMPTY_FILTERS = {
  id: "",
  part: "",
  partNumber: "",
  operatorId: "",
  machineId: "",
  from: "",
  to: "",
};

function History() {
  const [onlyReprints, setOnly] = useState(false);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<unknown>(null);
  const [operators, setOperators] = useState<Option[]>([]);
  const [machines, setMachines] = useState<Option[]>([]);

  useEffect(() => {
    void api<Option[]>("GET", "/admin/operators").then(setOperators);
    void api<Option[]>("GET", "/admin/machines").then(setMachines);
  }, []);
  useEffect(() => {
    const qs = new URLSearchParams({
      onlyReprints: String(onlyReprints),
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    for (const [k, v] of Object.entries(applied)) if (v) qs.set(k, v);
    void api<{ total: number; items: HistoryRow[] }>("GET", `/admin/history?${qs}`).then((r) => {
      setRows(r.items);
      setTotal(r.total);
    });
  }, [applied, onlyReprints, pageSize, page]);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  /** Exporta com os filtros aplicados (todas as linhas, não só a página). */
  const exportExcel = async (): Promise<void> => {
    const qs = new URLSearchParams({ onlyReprints: String(onlyReprints) });
    for (const [k, v] of Object.entries(applied)) if (v) qs.set(k, v);
    setExporting(true);
    setExportError("");
    try {
      await download(`/admin/history/export?${qs}`, "historico-etiquetas.xlsx");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Não foi possível gerar o relatório.");
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const set = (k: keyof typeof EMPTY_FILTERS) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="head">
        <h1 className="grow">Histórico</h1>
        <button className="secondary" disabled={exporting || total === 0} onClick={exportExcel}>
          {exporting ? "Gerando…" : "Exportar para Excel"}
        </button>
      </div>
      {exportError && (
        <div className="msg err" role="alert">
          {exportError}
        </div>
      )}
      <div className="tabs">
        <button
          className={!onlyReprints ? "active" : ""}
          onClick={() => {
            setOnly(false);
            setPage(0);
          }}
        >
          Todas as etiquetas
        </button>
        <button
          className={onlyReprints ? "active" : ""}
          onClick={() => {
            setOnly(true);
            setPage(0);
          }}
        >
          Reimpressões
        </button>
      </div>
      <div className="card">
        <div className="filters">
          <div>
            <label htmlFor="h-id">ID da etiqueta</label>
            <input id="h-id" value={f.id} onChange={set("id")} />
          </div>
          <div>
            <label htmlFor="h-part">Peça</label>
            <input id="h-part" value={f.part} onChange={set("part")} />
          </div>
          <div>
            <label htmlFor="h-pn">Part Number</label>
            <input id="h-pn" value={f.partNumber} onChange={set("partNumber")} />
          </div>
          <div>
            <label htmlFor="h-op">Operador</label>
            <select id="h-op" value={f.operatorId} onChange={set("operatorId")}>
              <option value="">Todos</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="h-mq">Máquina</label>
            <select id="h-mq" value={f.machineId} onChange={set("machineId")}>
              <option value="">Todas</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="h-from">De</label>
            <input id="h-from" type="date" value={f.from} onChange={set("from")} />
          </div>
          <div>
            <label htmlFor="h-to">Até</label>
            <input id="h-to" type="date" value={f.to} onChange={set("to")} />
          </div>
        </div>
        <p className="row">
          <button
            onClick={() => {
              setPage(0);
              setApplied(f);
            }}
          >
            Buscar
          </button>
          <button
            className="secondary"
            onClick={() => {
              setF(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setPage(0);
            }}
          >
            Limpar filtros
          </button>
        </p>
      </div>
      <div className="card">
        <p className="small">{total} etiqueta(s)</p>
        <table>
          <thead>
            <tr>
              <th>Peça</th>
              <th>Part Number</th>
              <th>Operador</th>
              <th>Máquina</th>
              <th>Turno</th>
              <th>Data/hora</th>
              <th>Situação</th>
              <th>Reimp.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.labelId}>
                <td>{r.partDescription}</td>
                <td>{r.partNumber}</td>
                <td>{r.operator}</td>
                <td>{r.machine}</td>
                <td>{r.shift}</td>
                <td>{new Date(r.producedAtUtc).toLocaleString("pt-BR")}</td>
                <td>{ATTEMPT_STATE_PT[r.lastState]}</td>
                <td>{r.reprints}</td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => void api("GET", `/admin/labels/${r.labelId}`).then(setDetail)}
                  >
                    Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pager">
          <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span>
            Página {page + 1} de {pages}
          </span>
          <button
            className="secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
          <span className="grow" />
          <label htmlFor="ps" style={{ margin: 0 }}>
            Por página
          </label>
          <select
            id="ps"
            style={{ width: 80 }}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {[10, 25, 50].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      {detail !== null && <Trace data={detail as TraceData} onClose={() => setDetail(null)} />}
    </>
  );
}

interface TraceData {
  label: {
    labelId: string;
    snapshot: {
      part: { description: string; partNumber: string };
      operator: { displayName: string };
      machine: { code: string };
      shift: { name: string };
      producedAtUtc: string;
    };
  };
  attempts: {
    id: string;
    printJobId: string;
    attemptNo: number;
    state: string;
    evidenceType: string | null;
  }[];
  jobs: { id: string; kind: string; reason: string | null }[];
}

function Trace({ data, onClose }: { data: TraceData; onClose: () => void }) {
  const s = data.label.snapshot;
  const kindPt: Record<string, string> = {
    ORIGINAL: "Original",
    RETRY: "Nova tentativa",
    REPRINT: "Reimpressão",
  };
  return (
    <div className="card">
      <h3>Rastreabilidade da etiqueta</h3>
      <p className="small">ID: {data.label.labelId}</p>
      <p>
        {s.part.description} · {s.part.partNumber} · {s.operator.displayName} · {s.machine.code} ·{" "}
        {s.shift.name} · {new Date(s.producedAtUtc).toLocaleString("pt-BR")}
      </p>
      <table>
        <thead>
          <tr>
            <th>Tentativa</th>
            <th>Pedido</th>
            <th>Situação</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {data.attempts.map((a) => {
            const j = data.jobs.find((x) => x.id === a.printJobId);
            return (
              <tr key={a.id}>
                <td>{a.attemptNo}</td>
                <td>{kindPt[j?.kind ?? ""] ?? ""}</td>
                <td>{ATTEMPT_STATE_PT[a.state]}</td>
                <td>{j?.reason ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        <button className="secondary" onClick={onClose}>
          Fechar
        </button>
      </p>
    </div>
  );
}

function Audit() {
  const [items, setItems] = useState<
    {
      id: string;
      at: number;
      description: string;
      actorId: string | null;
      result: string;
      correlationId: string;
    }[]
  >([]);
  useEffect(() => {
    void api<{ items: typeof items }>("GET", "/admin/audit?limit=200").then((r) =>
      setItems(r.items),
    );
  }, []);
  return (
    <>
      <div className="head">
        <h1 className="grow">Auditoria</h1>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Evento</th>
              <th>Resultado</th>
              <th>Código</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.at).toLocaleString("pt-BR")}</td>
                <td>{e.description}</td>
                <td>{e.result === "OK" ? "OK" : "Recusado"}</td>
                <td className="small">{e.correlationId.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
