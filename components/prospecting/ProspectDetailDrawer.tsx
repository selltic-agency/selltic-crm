// components/prospecting/ProspectDetailDrawer.tsx — szczegóły prospektu w
// wysuwanym panelu (wzorowane na pełnoekranowych modalach istniejących w
// aplikacji, np. NotInterestedModal w dawnej wersji strony Prospecting).
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, MapPin, Phone, Globe, Star, ExternalLink, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, formatDateTime } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { ScoreBreakdownList } from "@/components/ScoreBreakdown";
import { parseScoreBreakdown } from "@/lib/scoreBreakdown";
import { useClassification } from "@/lib/classification";
import { CategoryBadge, PurposeBadges } from "@/components/ClassificationBadges";
import {
  STATUS_LABEL,
  STATUS_COLOR,
  DISPLAY_STATUSES,
  toDisplayStatus,
  isClosedBusiness,
  scoreColor,
  scoreLabel,
  notesFromProps,
  googleMapsUrl,
  type WritableDisplayStatus,
} from "@/lib/prospectStatus";

export default function ProspectDetailDrawer({
  prospect,
  onClose,
  onConvert,
  onSetStatus,
  onAddNote,
  onSetCategory,
  onAddPurpose,
}: {
  prospect: Prospect;
  onClose: () => void;
  onConvert: (p: Prospect) => Promise<void>;
  onSetStatus: (p: Prospect, status: WritableDisplayStatus) => Promise<void>;
  onAddNote: (p: Prospect, body: string) => Promise<void>;
  onSetCategory: (p: Prospect, categoryKey: string) => Promise<void>;
  onAddPurpose: (p: Prospect, purposeKey: string) => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { categories, purposes } = useClassification();
  const p = prospect;
  const display = toDisplayStatus(p.prospecting_status);
  const closed = isClosedBusiness(p);

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deal, setDeal] = useState<{ id: string; name: string | null; stage: string } | null>(null);

  const notes = useMemo(
    () => [...notesFromProps(p.props)].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [p.props]
  );

  useEffect(() => {
    if (!p.converted_deal_id) {
      setDeal(null);
      return;
    }
    (async () => {
      const { data } = await supabase.from("deals").select("id, name, stage").eq("id", p.converted_deal_id).single();
      setDeal((data as { id: string; name: string | null; stage: string } | null) ?? null);
    })();
  }, [supabase, p.converted_deal_id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveNote() {
    if (!note.trim() || saving) return;
    setSaving(true);
    await onAddNote(p, note.trim());
    setNote("");
    setSaving(false);
  }

  async function handleConvert() {
    if (converting) return;
    setConverting(true);
    await onConvert(p);
    setConverting(false);
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 70 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(560px, 100vw)",
          background: tokens.bg,
          borderLeft: `1px solid ${tokens.border}`,
          boxShadow: "-20px 0 60px rgba(15,18,28,0.18)",
          zIndex: 71,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Nagłówek */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "20px 22px",
            background: tokens.card,
            borderBottom: `1px solid ${tokens.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0, overflowWrap: "break-word" }}>{p.name}</h2>
            <div style={{ fontSize: 13, color: tokens.muted, marginTop: 4 }}>
              {[p.industry, p.city].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <button onClick={onClose} aria-label="Zamknij" style={closeBtn}>
            <X size={18} color={tokens.muted} />
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: 22 }}>
          {/* Akcja konwersji — zawsze widoczna bez przewijania */}
          <div style={{ marginBottom: 18 }}>
            {closed ? (
              <div style={badgeBox(tokens.danger)}>🚫 Firma zamknięta — nie kontaktuj</div>
            ) : display === "converted" ? (
              <div style={badgeBox(tokens.success)}>
                ✅ Skonwertowany
                {p.converted_deal_id && (
                  <>
                    {" "}
                    →{" "}
                    <a href={`/admin/leads/${p.converted_deal_id}`} style={{ color: tokens.success, fontWeight: 700 }}>
                      zobacz deal
                    </a>
                  </>
                )}
              </div>
            ) : display === "not_interested" ? (
              <div style={badgeBox(tokens.danger)}>✗ Niezainteresowany</div>
            ) : (
              <button
                onClick={handleConvert}
                disabled={converting}
                style={{
                  width: "100%",
                  padding: "16px 20px",
                  borderRadius: 14,
                  border: "none",
                  background: tokens.success,
                  color: "#fff",
                  fontSize: 17,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {converting ? "Konwertowanie…" : "Konwertuj na lead"} <ArrowRight size={18} />
              </button>
            )}
          </div>

          {deal && (
            <Card>
              <SectionTitle>Powiązany deal</SectionTitle>
              <a
                href={`/admin/leads/${deal.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: tokens.text,
                  textDecoration: "none",
                }}
              >
                <span style={{ fontWeight: 700 }}>{deal.name || "Bez nazwy"}</span>
                <span style={{ fontSize: 12, color: tokens.accent, fontWeight: 700 }}>Etap: {deal.stage} →</span>
              </a>
            </Card>
          )}

          {/* Klasyfikacja (Feature 1 + 2): kategoria (jednowartościowa, można
              zmienić przy błędnej klasyfikacji) + cele kontaktu (wielowartościowe,
              dokładane bez nadpisywania). */}
          <Card>
            <SectionTitle>Klasyfikacja</SectionTitle>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: tokens.muted, fontWeight: 600 }}>Kategoria branży</span>
                <div><CategoryBadge categoryKey={p.category} /></div>
                <select
                  value={p.category ?? ""}
                  onChange={(e) => onSetCategory(p, e.target.value)}
                  style={{ ...inputStyle, maxWidth: 320 }}
                >
                  <option value="">— brak —</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: tokens.muted, fontWeight: 600 }}>Cele kontaktu</span>
                <div><PurposeBadges purposeKeys={p.purposes} /></div>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    e.currentTarget.value = "";
                    if (v) onAddPurpose(p, v);
                  }}
                  style={{ ...inputStyle, maxWidth: 320 }}
                >
                  <option value="">Dodaj cel kontaktu…</option>
                  {purposes.map((pp) => (
                    <option key={pp.key} value={pp.key}>
                      {pp.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* Właściwości */}
          <Card>
            <SectionTitle>Dane firmy</SectionTitle>
            <div style={{ display: "grid", gap: 10 }}>
              <Row label="Telefon">
                {p.phone ? (
                  <a href={`tel:${p.phone}`} style={{ color: tokens.accent, fontWeight: 700, display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <Phone size={14} /> {p.phone}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Strona">
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent, display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <Globe size={14} /> {p.website} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span style={{ color: tokens.success, fontWeight: 700 }}>Brak strony</span>
                )}
              </Row>
              <Row label="Adres">{p.address || "—"}</Row>
              <Row label="Ocena">
                {p.rating != null ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Star size={14} fill={tokens.warning} color={tokens.warning} /> {p.rating.toFixed(1)} ({p.review_count ?? 0} opinii)
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Branża">{p.industry || "—"}</Row>
              <Row label="Miasto">{p.city || "—"}</Row>
              <Row label="Status firmy">{p.business_status || "—"}</Row>
              <Row label="Score">
                {p.lead_score != null ? (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: `${scoreColor(p.lead_score)}1A`,
                      color: scoreColor(p.lead_score),
                    }}
                  >
                    {p.lead_score} · {scoreLabel(p.lead_score)}
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              {parseScoreBreakdown(p.lead_score_breakdown, p.props?.score_reasons).items.length > 0 && (
                <Row label="Wyjaśnienie">
                  <ScoreBreakdownList
                    score={p.lead_score}
                    breakdown={p.lead_score_breakdown}
                    fallbackReasons={p.props?.score_reasons}
                  />
                </Row>
              )}
            </div>

            <a
              href={googleMapsUrl(p)}
              target="_blank"
              rel="noreferrer"
              style={{
                marginTop: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 10,
                background: tokens.accentSoft,
                color: tokens.accent,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              <MapPin size={16} /> Google Maps
            </a>
          </Card>

          {/* Status */}
          <Card>
            <SectionTitle>Status</SectionTitle>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {DISPLAY_STATUSES.map((s) => {
                const active = s === display;
                const writable = s === "no_answer" || s === "not_interested";
                const clickable = writable && !active;
                return (
                  <button
                    key={s}
                    disabled={!clickable}
                    onClick={() => clickable && onSetStatus(p, s as WritableDisplayStatus)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                      border: `1px solid ${active ? STATUS_COLOR[s] : tokens.border}`,
                      background: active ? STATUS_COLOR[s] : "#fff",
                      color: active ? "#fff" : clickable ? tokens.text : tokens.muted,
                      cursor: clickable ? "pointer" : "default",
                      opacity: !active && !clickable ? 0.5 : 1,
                    }}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Notatki */}
          <Card>
            <SectionTitle>Notatki</SectionTitle>
            <textarea
              placeholder="Dodaj notatkę…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", width: "100%" }}
            />
            <div style={{ marginTop: 8 }}>
              <button onClick={saveNote} disabled={saving || !note.trim()} style={primaryButton}>
                {saving ? "Zapisywanie…" : "Zapisz notatkę"}
              </button>
            </div>

            {(notes.length > 0 || p.note) && (
              <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                {notes.map((n) => (
                  <div key={n.id} style={{ borderLeft: `2px solid ${tokens.border}`, paddingLeft: 12 }}>
                    <div style={{ fontSize: 11.5, color: tokens.muted, fontWeight: 600 }}>{formatDateTime(n.created_at)}</div>
                    <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap" }}>{n.body}</div>
                  </div>
                ))}
                {p.note && (
                  <div style={{ borderLeft: `2px solid ${tokens.border}`, paddingLeft: 12 }}>
                    <div style={{ fontSize: 11.5, color: tokens.muted, fontWeight: 600 }}>
                      {formatDateTime(p.last_contact_attempt_at ?? p.created_at)}
                    </div>
                    <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap" }}>{p.note}</div>
                  </div>
                )}
              </div>
            )}
            {notes.length === 0 && !p.note && (
              <p style={{ fontSize: 13, color: tokens.muted, marginTop: 14 }}>Brak notatek.</p>
            )}
          </Card>
        </div>
      </motion.div>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 18,
        marginBottom: 16,
      }}
    >
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: "0 0 12px",
      }}
    >
      {children}
    </h3>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span style={{ width: 100, flexShrink: 0, fontSize: 13, color: tokens.muted, fontWeight: 600, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: tokens.text, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function badgeBox(color: string): React.CSSProperties {
  return {
    padding: "14px 18px",
    borderRadius: 12,
    background: `${color}14`,
    color,
    fontWeight: 700,
    fontSize: 14,
    textAlign: "center",
  };
}

const closeBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  flexShrink: 0,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
