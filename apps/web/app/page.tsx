"use client";

import { useState } from "react";
import { Admin } from "../components/Admin";
import { Login } from "../components/Login";
import { Operator } from "../components/Operator";
import { api, setToken } from "../lib/api";
import type { LoginResult } from "../lib/types";

export default function Home() {
  const [session, setSession] = useState<LoginResult | null>(null);

  const logout = async (): Promise<void> => {
    try {
      await api("POST", "/auth/logout");
    } catch {
      /* sessão já inválida */
    }
    setToken(null);
    setSession(null);
  };

  if (!session) return <Login onLogin={setSession} />;
  return session.role === "ADMIN" ? (
    <Admin name={session.displayName} onLogout={logout} />
  ) : (
    <Operator name={session.displayName} onLogout={logout} onExpired={() => setSession(null)} />
  );
}
