// components/forms/SubmissionDrawer.tsx — szuflada szczegółów zgłoszenia,
// współdzielona przez globalną zakładkę „Zgłoszenia" (/admin/submissions).
// Dociąga schemat formularza, aby pokazać pytania obok odpowiedzi, atrybucję
// reklamową i metadane. Dla ukończonych zgłoszeń: skok do deala.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import { stepFields, type FormSchema, type Step, type FormField } from "@/lib/forms";
import { dropOffLabel } from "@/lib/formSessions";
import { useScrollLock } from "@/lib/useScrollLock";
import MIcon from "@/components/MaterialIcon";

const AMBER = "#F2994A";

export type SubmissionDetail = {
  sessionId: string;
  formId: string | null;
  formTitle: string;
  status: "completed" | "incomplete";
  when: string;
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;
  lastStep: number;
  totalSteps: number;
  dealId: string | null;
  dealName: string | null;
};

// Zwięzłe źródło pozyskania z metadanych sesji (UTM → Meta → referrer → bezpośrednio).
export function attributionSummary(meta: Record<string, unknown>): { label: string; fromAd: boolean } {
  const utm = (meta?.utm as Record<string, string>) || {};
  const src = utm.utm_source?.trim();
  const camp = utm.utm_campaign?.trim();
  const fbclid = (meta?.fbclid as string) || "";
  if (camp) return { label: src ? `${src} · ${camp}` : camp, fromAd: /fb|face|meta|ig|insta/i.test(src || "") || !!fbclid };
  if (src) return { label: src, fromAd: /fb|face|meta|ig|insta/i.test(src) || !!fbclid };
  if (fbclid) return { label: "Reklama Meta (fbclid)", fromAd: true };
  const ref = (meta?.referrer as string) || "";
  if (ref) {
    try { return { label: new URL(ref).hostname.replace(/^www\./, ""), fromAd: false }; } catch { /* ignore */ }
  }
  return { label: "Bezpośrednio", fromAd: false };
}

// Kontakt (imię / e-mail / telefon) wyłuskany ze schematu + odpowiedzi, a gdy
// brak schematu — heurystyką po wartościach.
export function extractContact(fields: FormField[], answers: Record<string, unknown>): string {
  let email = "", name = "", phone = "";
  for (const f of fields) {
    const v = answers[f.id];
    if (v == null || v === "") continue;
    if (f.type === "email" || f.map === "email" || f.mapping?.property === "email") email = String(v);
    else if (f.map === "name" || f.mapping?.property === "name") name = String(v);
    else if (f.type === "phone" || f.map === "phone" || f.mapping?.property === "phone") phone = String(v);
  }
  if (name || email || phone) return name || email || phone;
  // Heurystyka: brak dopasowanych pól → poszukaj e-maila/telefonu w wartościach.
  return heuristicContact(answers);
}

export function heuristicContact(answers: Record<string, unknown>): string {
  const vals = Object.values(answers).flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)]));
  const email = vals.find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  if (email) return email;
  const phone = vals.find((v) => /^\+?\d[\d\s-]{6,}$/.test(v));
  if (phone) return phone;
  const text = vals.find((v) => v.trim() && v.length <= 60);
  return text || "";
}

export default function SubmissionDrawer({ detail, onClose }: { detail: SubmissionDetail; onClose: () => void }) {
  useScrollLock();
  const supabase = useMemo(() => createClient(), []);
  const [schema, setSchema] = useState<FormSchema | null>(null);

  useEffect(() => {
    if (!detail.formId) return;
    supabase.from("forms").select("published, schema").eq("id", detail.formId).single().then(({ data }) => {
      setSchema(((data?.published ?? data?.schema) as FormSchema) ?? null);
    });
  }, [supabase, detail.formId]);

  const fields = useMemo(() => {
    const steps = (schema?.steps ?? []) as Step[];
    return steps.flatMap((s) => stepFields(s));
  }, [schema]);

  const stepQuestion = (index: number): string | null => {
    const steps = (schema?.steps ?? []) as Step[];
    const s = steps[index];
    if (!s) return null;
    return s.question?.trim() || stepFields(s)[0]?.question?.trim() || null;
  };

  const meta = detail.meta || {};
  const utm = (meta.utm as Record<string, string>) || {};
  const incomplete = detail.status !== "completed";

  // Odpowiedzi: gdy mamy schemat — pytanie obok wartości; w innym wypadku surowo.
  const answeredFromSchema = fields.filter((f) => {
    const v = detail.answers[f.id];
    return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  const rawEntries = Object.entries(detail.answers).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.4)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(480px, 100%)", height: "100%", background: tokens.card, overflowY: "auto", padding: 24, boxShadow: "-10px 0 30px rgba(0,0,0,0.12)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Zgłoszenie</h3>
          <button onClick={onClose} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted }}>
            <MIcon name="close" size={20} />
          </button>
        </div>

        <div style={{ fontSize: 13, color: tokens.muted, marginBottom: 6 }}>{detail.formTitle}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: incomplete ? "#FDF1E3" : "#E7F7EE", color: incomplete ? AMBER : tokens.success }}>
            {incomplete ? "Niekompletne" : "Ukończone"}
          </span>
          <span style={{ fontSize: 13, color: tokens.muted }}>{formatDateTime(detail.when)}</span>
        </div>

        {/* Skok do deala (ukończone) */}
        {detail.dealId && (
          <Link
            href={`/admin/leads/${detail.dealId}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: tokens.radiusSm, background: tokens.accent, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", marginBottom: 20 }}
          >
            <MIcon name="open_in_new" size={16} />
            Przejdź do deala{detail.dealName ? `: ${detail.dealName}` : ""}
          </Link>
        )}

        {incomplete && (
          <div style={{ fontSize: 13, color: AMBER, fontWeight: 600, marginBottom: 16 }}>
            Porzucono na kroku {dropOffLabel(detail.lastStep, detail.totalSteps, stepQuestion(detail.lastStep))}
          </div>
        )}

        {/* Odpowiedzi */}
        <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
          <h4 style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700 }}>Odpowiedzi</h4>
          {rawEntries.length === 0 && <p style={{ color: tokens.muted, fontSize: 14 }}>Brak zapisanych odpowiedzi.</p>}
          {schema
            ? answeredFromSchema.map((f) => {
                const v = detail.answers[f.id];
                return (
                  <div key={f.id}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 2 }}>{f.question || f.id}</div>
                    <div style={{ fontSize: 14, wordBreak: "break-word" }}>{Array.isArray(v) ? v.join(", ") : String(v)}</div>
                  </div>
                );
              })
            : rawEntries.map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 14, wordBreak: "break-word" }}>{Array.isArray(v) ? v.join(", ") : String(v)}</div>
                </div>
              ))}
        </div>

        {/* Atrybucja reklamowa */}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16, display: "grid", gap: 8 }}>
          <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Atrybucja reklamowa</h4>
          <MetaRow label="Źródło" value={attributionSummary(meta).label} />
          <MetaRow label="Kampania" value={(utm.utm_campaign as string) || "—"} />
          <MetaRow label="Medium" value={(utm.utm_medium as string) || "—"} />
          <MetaRow label="Kliknięcie Meta" value={(meta.fbclid as string) ? "tak (fbclid ✓)" : "—"} />
        </div>

        {/* Metadane techniczne */}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16, marginTop: 16, display: "grid", gap: 8 }}>
          <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Metadane</h4>
          <MetaRow label="Referrer" value={(meta.referrer as string) || "—"} />
          <MetaRow label="URL" value={(meta.url as string) || "—"} />
          <MetaRow label="Urządzenie" value={(meta.ua as string) || "—"} />
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
      <span style={{ color: tokens.muted, minWidth: 88, fontWeight: 600 }}>{label}</span>
      <span style={{ wordBreak: "break-word", flex: 1 }}>{value}</span>
    </div>
  );
}
