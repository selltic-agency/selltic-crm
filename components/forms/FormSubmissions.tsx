// components/forms/FormSubmissions.tsx — §6. Lista zgłoszeń NAPĘDZANA SESJAMI
// (nie samą tabelą submissions) — dzięki temu porzucone wypełnienia są widoczne.
// Filtr statusu All/Completed/Abandoned, kolumna kroku porzucenia, bursztynowa
// odznaka „Niekompletne”, szuflada z odpowiedziami + metadanymi.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatRelative, formatDateTime } from "@/lib/ui";
import type { FormSchema, Step, FormField } from "@/lib/forms";
import { stepFields } from "@/lib/forms";
import { dropOffLabel } from "@/lib/formSessions";
import MIcon from "@/components/MaterialIcon";

const AMBER = "#F2994A";

type SessionRow = {
  id: string;
  status: "viewed" | "started" | "abandoned" | "completed";
  started_at: string;
  last_seen_at: string;
  completed_at: string | null;
  last_step: number;
  total_steps: number;
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;
  submission_id: string | null;
};

type Filter = "all" | "completed" | "abandoned";

export default function FormSubmissions({ formId }: { formId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<SessionRow | null>(null);

  useEffect(() => {
    supabase.from("forms").select("published, schema").eq("id", formId).single().then(({ data }) => {
      setSchema(((data?.published ?? data?.schema) as FormSchema) ?? null);
    });
  }, [supabase, formId]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("form_sessions")
      .select("id, status, started_at, last_seen_at, completed_at, last_step, total_steps, answers, meta, submission_id")
      .eq("form_id", formId)
      .in("status", ["completed", "abandoned", "started"])
      .order("started_at", { ascending: false })
      .limit(500);
    setRows((data as SessionRow[]) ?? []);
    setLoading(false);
  }, [supabase, formId]);

  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => {
    const steps = (schema?.steps ?? []) as Step[];
    return steps.flatMap((s) => stepFields(s));
  }, [schema]);

  const filtered = useMemo(
    () => rows.filter((r) => {
      if (filter === "completed") return r.status === "completed";
      if (filter === "abandoned") return r.status === "abandoned" || r.status === "started";
      return true;
    }),
    [rows, filter]
  );

  const stepQuestion = useCallback(
    (index: number): string | null => {
      const steps = (schema?.steps ?? []) as Step[];
      const s = steps[index];
      if (!s) return null;
      return s.question?.trim() || stepFields(s)[0]?.question?.trim() || null;
    },
    [schema]
  );

  const counts = useMemo(() => ({
    all: rows.length,
    completed: rows.filter((r) => r.status === "completed").length,
    abandoned: rows.filter((r) => r.status === "abandoned" || r.status === "started").length,
  }), [rows]);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {([["all", "Wszystkie"], ["completed", "Ukończone"], ["abandoned", "Porzucone"]] as [Filter, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${filter === k ? tokens.accent : tokens.border}`,
              background: filter === k ? tokens.accentSoft : "#fff",
              color: filter === k ? tokens.accent : tokens.muted,
            }}
          >
            {label} <span style={{ opacity: 0.7 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : filtered.length === 0 ? (
        <div style={{ background: tokens.card, border: `1px dashed ${tokens.border}`, borderRadius: 16, padding: 32, textAlign: "center", color: tokens.muted }}>
          Brak zgłoszeń w tym filtrze.
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 840 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                  <th style={th}>KIEDY</th>
                  <th style={th}>STATUS</th>
                  <th style={th}>KONTAKT</th>
                  <th style={th}>ŹRÓDŁO</th>
                  <th style={th}>KROK PORZUCENIA</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const incomplete = r.status !== "completed";
                  const contact = extractContact(fields, r.answers);
                  const attrib = attributionSummary(r.meta || {});
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setOpen(r)}
                      style={{ borderBottom: `1px solid ${tokens.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={td}>{formatRelative(r.completed_at || r.started_at)}</td>
                      <td style={td}>
                        {incomplete ? (
                          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#FDF1E3", color: AMBER }}>
                            Niekompletne
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#E7F7EE", color: tokens.success }}>
                            Ukończone
                          </span>
                        )}
                      </td>
                      <td style={td}>{contact || <span style={{ color: tokens.muted }}>—</span>}</td>
                      <td style={td}>
                        <span
                          title={attrib.label}
                          style={{
                            display: "inline-block", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap", verticalAlign: "bottom",
                            fontWeight: attrib.fromAd ? 700 : 500,
                            color: attrib.fromAd ? tokens.accent : tokens.muted,
                          }}
                        >
                          {attrib.fromAd ? "📣 " : ""}{attrib.label}
                        </span>
                      </td>
                      <td style={td}>
                        {incomplete ? (
                          <span style={{ color: AMBER, fontWeight: 600 }}>
                            {dropOffLabel(r.last_step, r.total_steps, stepQuestion(r.last_step))}
                          </span>
                        ) : (
                          <span style={{ color: tokens.muted }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <Drawer session={open} fields={fields} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

// §7 (atrybucja reklam) — zwięzłe źródło pozyskania z metadanych sesji.
// Priorytet: kampania UTM → źródło UTM → kliknięcie reklamy Meta (fbclid) →
// domena referrera → wejście bezpośrednie.
function attributionSummary(meta: Record<string, unknown>): { label: string; fromAd: boolean } {
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

// Kontakt z odpowiedzi (pole email/name/phone lub heurystyka).
function extractContact(fields: FormField[], answers: Record<string, unknown>): string {
  let email = "", name = "";
  for (const f of fields) {
    const v = answers[f.id];
    if (v == null || v === "") continue;
    if (f.type === "email" || f.map === "email" || f.mapping?.property === "email") email = String(v);
    else if (f.map === "name" || f.mapping?.property === "name") name = String(v);
  }
  return name || email || "";
}

function Drawer({ session, fields, onClose }: { session: SessionRow; fields: FormField[]; onClose: () => void }) {
  const meta = session.meta || {};
  const utm = (meta.utm as Record<string, string>) || {};
  const answered = fields.filter((f) => {
    const v = session.answers[f.id];
    return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.4)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(480px, 100%)", height: "100%", background: tokens.card, overflowY: "auto", padding: 24, boxShadow: "-10px 0 30px rgba(0,0,0,0.12)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Zgłoszenie</h3>
          <button onClick={onClose} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted }}>
            <MIcon name="close" size={20} />
          </button>
        </div>

        <div style={{ fontSize: 13, color: tokens.muted, marginBottom: 16 }}>
          {session.status === "completed" ? "Ukończono" : "Porzucono"} · {formatDateTime(session.completed_at || session.started_at)}
        </div>

        {/* Odpowiedzi */}
        <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
          {answered.length === 0 && <p style={{ color: tokens.muted, fontSize: 14 }}>Brak zapisanych odpowiedzi.</p>}
          {answered.map((f) => {
            const v = session.answers[f.id];
            return (
              <div key={f.id}>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 2 }}>{f.question || f.id}</div>
                <div style={{ fontSize: 14 }}>{Array.isArray(v) ? v.join(", ") : String(v)}</div>
              </div>
            );
          })}
        </div>

        {/* Atrybucja reklamowa (§7) — skąd przyszedł ten lead. */}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16, display: "grid", gap: 8 }}>
          <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Atrybucja reklamowa</h4>
          <Meta label="Źródło" value={attributionSummary(meta).label} />
          <Meta label="Kampania" value={(utm.utm_campaign as string) || "—"} />
          <Meta label="Medium" value={(utm.utm_medium as string) || "—"} />
          <Meta label="Treść / reklama" value={(utm.utm_content as string) || (utm.utm_term as string) || "—"} />
          <Meta label="Kliknięcie Meta" value={(meta.fbclid as string) ? "tak (fbclid ✓)" : "—"} />
          <Meta label="Cookie Meta" value={[meta.fbp ? "_fbp" : "", meta.fbc ? "_fbc" : ""].filter(Boolean).join(", ") || "—"} />
        </div>

        {/* Metadane techniczne */}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16, marginTop: 16, display: "grid", gap: 8 }}>
          <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Metadane</h4>
          <Meta label="Referrer" value={(meta.referrer as string) || "—"} />
          <Meta label="URL" value={(meta.url as string) || "—"} />
          <Meta label="Urządzenie" value={(meta.ua as string) || "—"} />
          {Object.keys(utm).length > 0 && (
            <Meta label="Wszystkie UTM" value={Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(", ")} />
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
      <span style={{ color: tokens.muted, minWidth: 88, fontWeight: 600 }}>{label}</span>
      <span style={{ wordBreak: "break-word", flex: 1 }}>{value}</span>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "12px 16px", fontSize: 12, fontWeight: 700, color: tokens.muted, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "13px 16px", fontSize: 14, color: tokens.text };
