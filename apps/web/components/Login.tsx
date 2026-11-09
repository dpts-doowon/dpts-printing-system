"use client";

import { useState } from "react";
import { ApiError, STATION_ID, api, setToken } from "../lib/api";
import type { LoginResult } from "../lib/types";
import { Logo } from "./Brand";

export function Login({ onLogin }: { onLogin: (s: LoginResult) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<LoginResult>("POST", "/auth/login", {
        username,
        password,
        stationId: STATION_ID,
      });
      setToken(r.token);
      onLogin(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ocorreu um erro.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-side">
        <Logo />
        <h1>D-PTS</h1>
        <p className="sys-name">Doowon Part Tracking System</p>
        <ul style={{ padding: 0, margin: 0 }}>
          <li>Etiquetas com rastreabilidade completa</li>
          <li>Cada impressão registrada e auditável</li>
          <li>Operação simples no posto de trabalho</li>
        </ul>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Acesse sua conta</h2>
          <p className="small">Informe seu usuário e senha para continuar.</p>
          <label htmlFor="u">Usuário</label>
          <input
            id="u"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
          <label htmlFor="p">Senha</label>
          <input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && (
            <div className="msg err" role="alert">
              {error}
            </div>
          )}
          <p>
            <button
              type="submit"
              disabled={busy || !username || !password}
              style={{ width: "100%", fontSize: 20 }}
            >
              Entrar
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
