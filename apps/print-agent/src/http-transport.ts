import type { AgentInfo, AttemptResult } from "@doowon/domain";
import type { AgentTransport, ClaimedAttemptDto } from "@doowon/printer-contracts";

/** Transporte HTTPS (somente conexões de saída). A estação e a impressora são derivadas do token no servidor. */
export class HttpTransport implements AgentTransport {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 10_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-token": this.token },
      body: JSON.stringify(body ?? {}),
      // Sem prazo, uma requisição travada paralisaria o agente (a rede pode cair sem fechar a conexão).
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async heartbeat(info: AgentInfo): Promise<void> {
    await this.call("/agent/heartbeat", info);
  }
  claim(info: AgentInfo): Promise<ClaimedAttemptDto | null> {
    return this.call("/agent/claim", info);
  }
  claimBatch(info: AgentInfo, max: number): Promise<ClaimedAttemptDto[]> {
    return this.call("/agent/claim-batch", { ...info, max });
  }
  async ack(attemptId: string): Promise<void> {
    await this.call(`/agent/attempts/${attemptId}/ack`);
  }
  async report(attemptId: string, result: AttemptResult): Promise<void> {
    await this.call(`/agent/attempts/${attemptId}/result`, result);
  }
  async release(attemptId: string): Promise<void> {
    await this.call(`/agent/attempts/${attemptId}/release`);
  }
  async renew(attemptId: string): Promise<void> {
    await this.call(`/agent/attempts/${attemptId}/renew`);
  }
  async journalUnavailable(): Promise<void> {
    await this.call("/agent/journal-unavailable");
  }
}
