// app/login/page.tsx — logowanie admina (Supabase Auth, hasło).
// To jedyne konto logowania; klienci nigdy się nie logują.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Nie udało się zalogować. Sprawdź email i hasło.");
      setLoading(false);
      return;
    }

    // Sesja zapisana w cookies → middleware wpuści na /admin.
    router.push("/admin");
    router.refresh();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 28,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Selltic</h1>
        <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 14 }}>
          Zaloguj się do panelu
        </p>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />

        <label style={labelStyle}>Hasło</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        {error && (
          <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? "Logowanie…" : "Zaloguj się"}
        </button>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  margin: "0 0 6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  marginBottom: 16,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
};

function buttonStyle(loading: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "11px 12px",
    background: loading ? "#9ca3af" : "#111827",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? "default" : "pointer",
  };
}
