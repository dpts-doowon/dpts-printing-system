import type { AgentInfo, AttemptResult, PrintAttempt, PrintService } from "@doowon/domain";
import type { AgentTransport, ClaimedAttemptDto } from "@doowon/printer-contracts";

const toDto = (a: PrintAttempt): ClaimedAttemptDto => ({
  attemptId: a.id,
  printJobId: a.printJobId,
  labelId: a.labelId,
  attemptNo: a.attemptNo,
  correlationId: a.correlationId,
  payloadHash: a.payloadHash,
  templateVersion: a.templateVersion,
  qrSchemaVersion: a.qrSchemaVersion,
  renderSnapshot: a.renderSnapshot,
});

/** Transporte em processo: liga o agente diretamente ao PrintService (testes e simulações locais). */
export class InProcessTransport implements AgentTransport {
  failAck = false;
  failReportTimes = 0;

  constructor(
    private svc: PrintService,
    private agentId: string,
    private stationId: string,
  ) {}

  heartbeat(info: AgentInfo): Promise<void> {
    return this.svc.heartbeat(info);
  }

  async claim(info: AgentInfo): Promise<ClaimedAttemptDto | null> {
    const a = await this.svc.claimNext(info);
    return a ? toDto(a) : null;
  }

  async claimBatch(info: AgentInfo, max: number): Promise<ClaimedAttemptDto[]> {
    return (await this.svc.claimBatch(info, max)).map(toDto);
  }

  async ack(attemptId: string): Promise<void> {
    if (this.failAck) throw new Error("rede indisponível");
    await this.svc.ackSending(attemptId, this.agentId);
  }

  async report(attemptId: string, result: AttemptResult): Promise<void> {
    if (this.failReportTimes > 0) {
      this.failReportTimes--;
      throw new Error("rede indisponível");
    }
    await this.svc.reportResult(attemptId, this.agentId, result);
  }

  release(attemptId: string): Promise<void> {
    return this.svc.releaseClaim(attemptId, this.agentId);
  }

  renew(attemptId: string): Promise<void> {
    return this.svc.renewLease(attemptId, this.agentId);
  }

  async journalUnavailable(): Promise<void> {
    await this.svc.markSendingUnknownForStation(this.stationId, this.agentId);
  }
}
