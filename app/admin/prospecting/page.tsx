// app/admin/prospecting/page.tsx — Prospecting: zimne leady z Google Maps.
// Faza 10. Minimalna wersja: tabela + filtry + akcje wiersza. Kolumny
// scoringu (website_status/lead_score) puste, dopóki scraper ich nie wypełni.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, X, CheckCircle2, ExternalLink, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, ghostButton, formatDateTime } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Prospect, ProspectingStatus } from "@/lib/types";

const STATUS_LABEL: Record<ProspectingStatus, string> = {
  new: "Nowy",
  contact_attempted: "Próba kontaktu",
  not_interested: "Niezainteresowany",
  converted: "Zakwalifikowany",
};

// Standardowy format linku Google Maps do konkretnego miejsca (Places API).
function googleMapsUrl(p: Prospect): string {
  const query = encodeURIComponent(`${p.name} ${p.address ?? ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(p.place_id)}`;
}

const STATUS_COLOR: Record<ProspectingStatus, string> = {
  new: tokens.accent,
  contact_attempted: tokens.warning,
  not_interested: tokens.muted,
  converted: tokens.success,
};

export default function ProspectingPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const router = useRouter();

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(false);

  const [noteModal, setNoteModal] = useState<Prospect | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("prospects")
      .select("*")
      .order("lead_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (statusFilter) query = query.eq("prospecting_status", statusFilter);
    if (industryFilter) query = query.eq("industry", industryFilter);
    if (cityFilter) query = query.eq("city", cityFilter);
    if (noWebsiteOnly) query = query.is("website", null);

    const { data } = await query;
    setProspects((data as Prospect[]) ?? []);
    setLoading(false);
  }, [supabase, statusFilter, industryFilter, cityFilter, noWebsiteOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Dashboard liczników i opcje filtrów — niezależne od aktywnych filtrów.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("prospects").select("prospecting_status, industry, city");
      const rows = (data as { prospecting_status: string; industry: string | null; city: string | null }[]) ?? [];
      const c: Record<string, number> = { new: 0, contact_attempted: 0, not_interested: 0, converted: 0 };
      for (const r of rows) c[r.prospecting_status] = (c[r.prospecting_status] ?? 0) + 1;
      setCounts(c);
      setIndustries([...new Set(rows.map((r) => r.industry).filter(Boolean))] as string[]);
      setCities([...new Set(rows.map((r) => r.city).filter(Boolean))] as string[]);
    })();
  }, [supabase, prospects.length]);

  async function setStatus(p: Prospect, status: "contact_attempted" | "not_interested", note?: string | null) {
    const res = await fetch(`/api/prospecting/${p.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: note ?? null }),
    });
    if (!res.ok) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return;
    }
    const updated = await res.json();
    setProspects((list) => list.map((x) => (x.id === p.id ? (updated as Prospect) : x)));
    toast.success("Zaktualizowano.");
  }

  async function convertToLead(p: Prospect) {
    const res = await fetch(`/api/prospecting/${p.id}/convert-to-lead`, { method: "POST" });
    if (!res.ok) {
      toast.error("Nie udało się zakwalifikować prospektu.");
      return;
    }
    const { deal_id, contact_id } = await res.json();
    setProspects((list) =>
      list.map((x) =>
        x.id === p.id
          ? { ...x, prospecting_status: "converted", converted_deal_id: deal_id, converted_contact_id: contact_id }
          : x
      )
    );
    toast.success("Prospekt zakwalifikowany — deal utworzony.");
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Prospecting</h1>

      {/* Dashboard liczników */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {(Object.keys(STATUS_LABEL) as ProspectingStatus[]).map((s) => (
          <div
            key={s}
            style={{
              background: tokens.card,
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radius,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, textTransform: "uppercase" }}>
              {STATUS_LABEL[s]}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: STATUS_COLOR[s] }}>
              {counts[s] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Filtry */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">Wszystkie statusy</option>
          {(Object.keys(STATUS_LABEL) as ProspectingStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">Wszystkie branże</option>
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">Wszystkie miasta</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={noWebsiteOnly} onChange={(e) => setNoWebsiteOnly(e.target.checked)} />
          Tylko bez strony
        </label>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                  {["NAZWA", "TELEFON", "STRONA", "ADRES", "OCENA", "OPINIE", "BRANŻA", "MIASTO", "SCORE", "STATUS", "POWIĄZANE", "DODANO", ""].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {p.name}
                        <a
                          href={googleMapsUrl(p)}
                          target="_blank"
                          rel="noreferrer"
                          title="Zobacz na Google Maps"
                          style={{ color: tokens.muted, display: "inline-flex" }}
                        >
                          <MapPin size={13} />
                        </a>
                      </div>
                    </td>
                    <td style={tdStyle}>{p.phone || "—"}</td>
                    <td style={tdStyle}>
                      {p.website ? (
                        <a href={p.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          Link <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span style={{ color: tokens.danger }}>Brak</span>
                      )}
                    </td>
                    <td style={tdStyle}>{p.address || "—"}</td>
                    <td style={tdStyle}>{p.rating ?? "—"}</td>
                    <td style={tdStyle}>{p.review_count ?? "—"}</td>
                    <td style={tdStyle}>{p.industry || "—"}</td>
                    <td style={tdStyle}>{p.city || "—"}</td>
                    <td style={tdStyle}>
                      {p.lead_score == null ? (
                        <span style={{ color: tokens.muted }}>—</span>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "3px 10px",
                            borderRadius: 999,
                            background: `${scoreColor(p.lead_score)}1A`,
                            color: scoreColor(p.lead_score),
                          }}
                        >
                          {p.lead_score}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "3px 10px",
                          borderRadius: 999,
                          background: `${STATUS_COLOR[p.prospecting_status]}1A`,
                          color: STATUS_COLOR[p.prospecting_status],
                        }}
                      >
                        {STATUS_LABEL[p.prospecting_status]}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {p.prospecting_status === "converted" && (p.converted_deal_id || p.converted_contact_id) ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                          {p.converted_contact_id && (
                            <a
                              onClick={() => router.push(`/admin/contacts/${p.converted_contact_id}`)}
                              style={{ color: tokens.accent, cursor: "pointer" }}
                            >
                              Kontakt →
                            </a>
                          )}
                          {p.converted_deal_id && (
                            <a
                              onClick={() => router.push(`/admin/leads/${p.converted_deal_id}`)}
                              style={{ color: tokens.accent, cursor: "pointer" }}
                            >
                              Deal →
                            </a>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: tokens.muted }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>{formatDateTime(p.created_at)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button title="Próba kontaktu" onClick={() => setStatus(p, "contact_attempted")} style={rowBtn}>
                          <Phone size={14} />
                        </button>
                        <button title="Niezainteresowany" onClick={() => setNoteModal(p)} style={rowBtn}>
                          <X size={14} />
                        </button>
                        <button
                          title="Zakwalifikuj"
                          onClick={() => convertToLead(p)}
                          disabled={p.prospecting_status === "converted"}
                          style={{ ...rowBtn, opacity: p.prospecting_status === "converted" ? 0.4 : 1 }}
                        >
                          <CheckCircle2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {prospects.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ padding: 40, textAlign: "center", color: tokens.muted }}>
                      Brak prospektów spełniających kryteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {noteModal && (
        <NotInterestedModal
          prospect={noteModal}
          onClose={() => setNoteModal(null)}
          onConfirm={(note) => {
            setStatus(noteModal, "not_interested", note);
            setNoteModal(null);
          }}
        />
      )}
    </div>
  );
}

function NotInterestedModal({
  prospect,
  onClose,
  onConfirm,
}: {
  prospect: Prospect;
  onClose: () => void;
  onConfirm: (note: string | null) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(420px, calc(100vw - 32px))",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 41,
          padding: 22,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Oznacz jako niezainteresowany</h2>
        <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 12px" }}>{prospect.name}</p>
        <textarea
          placeholder="Notatka (opcjonalnie)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", width: "100%", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={ghostButton}>Anuluj</button>
          <button
            onClick={() => onConfirm(note.trim() || null)}
            style={{ ...ghostButton, background: tokens.danger, color: "#fff", border: "none" }}
          >
            Potwierdź
          </button>
        </div>
      </div>
    </>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return tokens.success;
  if (score >= 40) return tokens.warning;
  return tokens.danger;
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 12,
  fontWeight: 700,
  color: tokens.muted,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
  whiteSpace: "nowrap",
};

const rowBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: tokens.text,
};
