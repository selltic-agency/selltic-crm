// components/forms/MetaSettings.tsx — §9a. Ustawienia Meta per-formularz.
// Token CAPI NIGDY nie wraca do klienta — pokazujemy tylko stan „ustawiony”.
// Puste pole tokenu przy zapisie = bez zmian. Ustawienia globalne (app_settings)
// są fallbackiem po stronie serwera; tu edytujemy nadpisania per-formularz.
"use client";

import { useCallback, useEffect, useState } from "react";
import { tokens, inputStyle, primaryButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";

type MetaState = {
  pixelId: string;
  tokenConfigured: boolean;
  testEventCode: string;
  eventsEnabled: boolean;
  webhookUrl: string;
};

export default function MetaSettings({ formId }: { formId: string }) {
  const toast = useToast();
  const [state, setState] = useState<MetaState | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/forms/${formId}/meta`);
      if (res.ok) setState(await res.json());
      else setState({ pixelId: "", tokenConfigured: false, testEventCode: "", eventsEnabled: false, webhookUrl: "" });
    } catch {
      setState({ pixelId: "", tokenConfigured: false, testEventCode: "", eventsEnabled: false, webhookUrl: "" });
    }
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!state) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/forms/${formId}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pixelId: state.pixelId,
          testEventCode: state.testEventCode,
          eventsEnabled: state.eventsEnabled,
          webhookUrl: state.webhookUrl,
          ...(tokenInput.trim() ? { capiToken: tokenInput.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) toast.error(body?.error || "Nie udało się zapisać.");
      else {
        toast.success("Zapisano ustawienia Meta.");
        setTokenInput("");
        load();
      }
    } catch {
      toast.error("Błąd sieci.");
    }
    setSaving(false);
  }

  async function clearToken() {
    setSaving(true);
    await fetch(`/api/forms/${formId}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearToken: true }),
    });
    setSaving(false);
    toast.success("Usunięto token CAPI.");
    load();
  }

  if (!state) return <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={label}>
        <span style={labelText}>Meta Pixel ID</span>
        <input value={state.pixelId} onChange={(e) => setState({ ...state, pixelId: e.target.value })} placeholder="np. 1234567890" style={inputStyle} />
      </label>

      <label style={label}>
        <span style={labelText}>
          Conversions API — token dostępu {state.tokenConfigured && <em style={{ color: tokens.success, fontStyle: "normal" }}>✓ ustawiony</em>}
        </span>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder={state.tokenConfigured ? "•••••••••• (zostaw puste, by nie zmieniać)" : "wklej token"}
          style={inputStyle}
        />
        <span style={{ fontSize: 12, color: tokens.muted }}>
          Token jest trzymany wyłącznie po stronie serwera i nigdy nie wraca do przeglądarki.
          {state.tokenConfigured && (
            <button type="button" onClick={clearToken} style={{ marginLeft: 8, color: tokens.danger, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
              Usuń token
            </button>
          )}
        </span>
      </label>

      <label style={label}>
        <span style={labelText}>Kod zdarzenia testowego (opcjonalnie)</span>
        <input value={state.testEventCode} onChange={(e) => setState({ ...state, testEventCode: e.target.value })} placeholder="TEST12345" style={inputStyle} />
      </label>

      <label style={label}>
        <span style={labelText}>Webhook (POST JSON zgłoszenia — Make/Zapier/GA4)</span>
        <input value={state.webhookUrl} onChange={(e) => setState({ ...state, webhookUrl: e.target.value })} placeholder="https://hook.make.com/…" style={inputStyle} />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}>
        <input type="checkbox" checked={state.eventsEnabled} onChange={(e) => setState({ ...state, eventsEnabled: e.target.checked })} />
        Wysyłaj zdarzenia Meta (Pixel + CAPI)
      </label>

      <div>
        <button onClick={save} disabled={saving} style={primaryButton}>
          {saving ? "Zapisywanie…" : "Zapisz ustawienia Meta"}
        </button>
      </div>
    </div>
  );
}

const label: React.CSSProperties = { display: "grid", gap: 5 };
const labelText: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: tokens.muted };
