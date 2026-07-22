// components/email/SendEmailModal.tsx — modal „Wyślij e-mail” z karty leada.
// Wybór szablonu → automatyczne wypełnienie pól danymi leada → podgląd/edycja
// → wysyłka przez /api/email/send (Resend z Ustawień). Po wysyłce rodzic
// odświeża oś czasu (wpis „email” dopisuje backend).
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Deal, EmailTemplate } from "@/lib/types";
import { dealFieldValues, renderText, renderHtml } from "@/lib/emailTemplates";
import { RichTextEditor } from "@/components/email/EmailComposer";
import MIcon from "@/components/MaterialIcon";
import { useScrollLock } from "@/lib/useScrollLock";

export function SendEmailModal({
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
  const values = useMemo(() => dealFieldValues(deal), [deal]);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // Klucz wymusza remount edytora treści przy zmianie szablonu (świeża treść).
  const [editorKey, setEditorKey] = useState(0);
  const [sending, setSending] = useState(false);

  const to = (deal.email || "").trim();
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("*")
        .order("updated_at", { ascending: false });
      setTemplates((data as EmailTemplate[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) {
      setSubject("");
      setBody("");
    } else {
      setSubject(renderText(t.subject, values));
      setBody(renderHtml(t.body, values));
    }
    setEditorKey((k) => k + 1);
  }

  async function send() {
    if (!hasEmail) {
      toast.error("Lead nie ma poprawnego adresu e-mail.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Temat nie może być pusty.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, to, subject, html: body }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(b?.error || "Nie udało się wysłać.");
        setSending(false);
        return;
      }
      toast.success(`E-mail wysłany do ${to}.`);
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
          width: "min(620px, calc(100vw - 32px))",
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
            <MIcon name="mail" size={17} color={tokens.accent} />
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Wyślij e-mail</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
          >
            <MIcon name="close" size={15} color={tokens.muted} />
          </button>
        </div>

        {/* Adresat */}
        <div style={{ marginBottom: 14, fontSize: 13.5, color: tokens.text }}>
          <span style={{ color: tokens.muted }}>Do: </span>
          {hasEmail ? (
            <b>{to}</b>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tokens.danger, fontWeight: 600 }}>
              <MIcon name="error" size={14} /> Lead nie ma adresu e-mail — uzupełnij go w danych kontaktowych.
            </span>
          )}
        </div>

        {loading ? (
          <p style={{ color: tokens.muted }}>Wczytywanie szablonów…</p>
        ) : templates.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${tokens.border}`,
              borderRadius: 12,
              padding: 20,
              textAlign: "center",
              color: tokens.muted,
              fontSize: 13.5,
            }}
          >
            Brak szablonów. Utwórz je w Ustawienia → Szablony e-mail.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Szablon</span>
              <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={inputStyle}>
                <option value="">— wybierz szablon —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            {templateId && (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Temat</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
                </label>

                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Treść</span>
                  <span style={{ fontSize: 12, color: tokens.muted }}>
                    Pola dynamiczne są już wypełnione danymi leada. Możesz nanieść drobne poprawki przed wysłaniem.
                  </span>
                  <RichTextEditor key={editorKey} initialHtml={body} onChange={setBody} minHeight={180} />
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} style={ghostButton}>
                Anuluj
              </button>
              <button onClick={send} disabled={sending || !hasEmail || !templateId} style={{ ...primaryButton, opacity: sending || !hasEmail || !templateId ? 0.5 : 1 }}>
                {sending ? "Wysyłanie…" : "Wyślij e-mail"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
