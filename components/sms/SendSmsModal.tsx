// components/sms/SendSmsModal.tsx — modal „Wyślij SMS" z karty leada.
// Wybór szablonu → treść wypełniona danymi leada → licznik/segmenty na żywo →
// przełącznik „usuń diakrytyki" (GSM-7) → wysyłka przez /api/sms/send. Po wysyłce
// rodzic odświeża oś czasu (wpis „sms" dopisuje serwis).
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Deal, SmsKind, SmsTemplate } from "@/lib/types";
import { toE164 } from "@/lib/phone";
import { dealSmsValues } from "@/lib/sms/values";
import { renderSmsTemplate, SMS_VARIABLES } from "@/lib/sms/templates";
import { stripDiacritics } from "@/lib/sms/encoding";
import { SmsCounter } from "@/components/sms/SmsCounter";
import MIcon from "@/components/MaterialIcon";
import { useScrollLock } from "@/lib/useScrollLock";

export function SendSmsModal({
  deal,
  onClose,
  onSent,
}: {
  deal: Deal;
  onClose: () => void;
  onSent: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  useScrollLock();
  const toast = useToast();
  const values = useMemo(() => dealSmsValues(deal), [deal]);

  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [sender, setSender] = useState<string>("");
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState<string>("");
  const [kind, setKind] = useState<SmsKind>("transactional");
  const [body, setBody] = useState("");
  const [strip, setStrip] = useState(false);
  const [sending, setSending] = useState(false);

  const e164 = toE164(deal.phone || "");
  const hasPhone = !!e164;
  const finalBody = strip ? stripDiacritics(body) : body;

  useEffect(() => {
    (async () => {
      const [{ data }, cfgRes] = await Promise.all([
        supabase.from("sms_templates").select("*").eq("is_active", true).order("updated_at", { ascending: false }),
        fetch("/api/sms/config").then((r) => r.json()).catch(() => null),
      ]);
      setTemplates((data as SmsTemplate[]) ?? []);
      if (cfgRes && !cfgRes.error) {
        setSender(cfgRes.sender || "");
        setTestMode(!!cfgRes.testMode);
      }
      setLoading(false);
    })();
  }, [supabase]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) {
      setBody("");
      setKind("transactional");
      return;
    }
    setKind(t.kind);
    setBody(renderSmsTemplate(t.body, values, "graceful").text);
  }

  function insertVariable(key: string) {
    setBody((b) => `${b}{{${key}}}`);
  }

  async function send() {
    if (!hasPhone) {
      toast.error("Lead nie ma poprawnego numeru telefonu.");
      return;
    }
    if (!finalBody.trim()) {
      toast.error("Treść nie może być pusta.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relatedType: "deal",
          relatedId: deal.id,
          to: e164,
          body: finalBody,
          kind,
          templateId: templateId || null,
        }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(b?.error || "Nie udało się wysłać.");
        setSending(false);
        return;
      }
      toast.success(testMode ? "SMS zwalidowany (tryb testowy — nie wysłano)." : `SMS wysłany na ${e164}.`);
      onSent();
      onClose();
    } catch {
      toast.error("Błąd sieci przy wysyłce.");
      setSending(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 50 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "8%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "min(84vh, calc(100vh - 80px))",
          overflowY: "auto",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 51,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MIcon name="chat" size={17} color={tokens.accent} />
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Wyślij SMS</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
          >
            <MIcon name="close" size={15} color={tokens.muted} />
          </button>
        </div>

        {/* Nadawca (read-only) + adresat */}
        <div style={{ marginBottom: 12, fontSize: 13.5, color: tokens.text, display: "grid", gap: 4 }}>
          <div>
            <span style={{ color: tokens.muted }}>Nadawca: </span>
            <b>{sender || "— nieskonfigurowany —"}</b>
          </div>
          <div>
            <span style={{ color: tokens.muted }}>Do: </span>
            {hasPhone ? (
              <b>{e164}</b>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tokens.danger, fontWeight: 600 }}>
                <MIcon name="error" size={14} /> Lead nie ma poprawnego numeru — uzupełnij go w danych kontaktowych.
              </span>
            )}
          </div>
          {testMode && (
            <div style={{ fontSize: 12, color: tokens.warning, fontWeight: 600 }}>
              Tryb testowy: wiadomość zostanie zwalidowana, ale nie dostarczona.
            </div>
          )}
        </div>

        {loading ? (
          <p style={{ color: tokens.muted }}>Wczytywanie…</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Szablon (opcjonalnie)</span>
              <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={inputStyle}>
                <option value="">— pisz od zera —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.kind === "marketing" ? "(marketing)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Treść</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SMS_VARIABLES.map((v) => (
                  <button key={v.key} type="button" onClick={() => insertVariable(v.key)} style={{ ...ghostButton, padding: "4px 10px", fontSize: 12 }}>
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Treść wiadomości…"
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
              <SmsCounter text={finalBody} />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
              Usuń polskie znaki (GSM-7 — 160 znaków/segment zamiast 70)
            </label>

            {kind === "marketing" && (
              <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "#8a5a1f", background: "rgba(242,153,74,0.10)", border: "1px solid rgba(242,153,74,0.35)", borderRadius: 10, padding: "10px 12px" }}>
                <MIcon name="warning" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                Szablon marketingowy — wysyłka wymaga zgody marketingowej leada (egzekwowane po stronie serwera).
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} style={ghostButton}>
                Anuluj
              </button>
              <button
                onClick={send}
                disabled={sending || !hasPhone || !finalBody.trim()}
                style={{ ...primaryButton, opacity: sending || !hasPhone || !finalBody.trim() ? 0.5 : 1 }}
              >
                {sending ? "Wysyłanie…" : "Wyślij SMS"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
