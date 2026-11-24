export const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
export const STATION_ID = process.env["NEXT_PUBLIC_STATION_ID"] ?? "st-1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
export const setToken = (t: string | null): void => {
  token = t;
};

/** UUID v4 que funciona também em HTTP (crypto.randomUUID só existe em contexto seguro/HTTPS). */
export const newKey = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const correlationId = newKey();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Sem conexão com o sistema. A impressão não foi iniciada.",
      correlationId,
    );
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.code ?? "HTTP_ERROR",
      data?.message ?? "Ocorreu um erro.",
      data?.correlationId ?? correlationId,
    );
  return data as T;
}

/** Baixa um arquivo (ex.: relatório em Excel) com a sessão atual. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const correlationId = newKey();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: {
        "x-correlation-id": correlationId,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Sem conexão com o sistema.", correlationId);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      data?.code ?? "HTTP_ERROR",
      data?.message ?? "Não foi possível gerar o relatório.",
      correlationId,
    );
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
