export interface AttemptSummary {
  attemptId: string;
  labelId: string;
  sequence: number;
  attemptNo: number;
  state: string;
  held: boolean;
  label: {
    description: string;
    partNumber: string;
    operator: string;
    shift: string;
    producedAtUtc: string;
    qr: string;
    labelId: string;
  };
}
export interface JobSummary {
  printJobId: string;
  kind: "ORIGINAL" | "RETRY" | "REPRINT";
  status: string;
  quantity: number;
  correlationId: string;
  attempts: AttemptSummary[];
  counts: Record<string, number>;
  replayed?: boolean;
}
export interface OperatorContext {
  station: { id: string; name: string };
  machines: { id: string; code: string; name: string }[];
  fixedMachine: boolean;
  printer: { name?: string; status: "READY" | "UNAVAILABLE" | "UNKNOWN" | "OFFLINE" };
  shift: { id: string; name: string } | null;
  parts: { id: string; description: string; partNumber: string }[];
  quantities: number[];
  activeJob: JobSummary | null;
}
export interface LoginResult {
  token: string;
  role: "OPERATOR" | "ADMIN";
  displayName: string;
  stationId: string | null;
}
