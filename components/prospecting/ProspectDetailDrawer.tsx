// components/prospecting/ProspectDetailDrawer.tsx — szeroka szuflada (760 px)
// w układzie dwukolumnowym (HubSpot-style): lewa kolumna = właściwości
// pogrupowane i edytowalne inline (na górze kontrola statusu + szybka akcja
// „Nie odbiera"), prawa kolumna = kompozytor notatek + oś czasu (te same dane
// co historia trybu dzwonienia). Przewijanie żyje wewnątrz kolumn.
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, ghostButton, primaryButton, menuPanel } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";
import { useClassification } from "@/lib/classification";
import { useEntityProperties } from "@/lib/properties";
import { PropertyValueInput } from "@/components/PropertyFields";
import { useToast } from "@/components/Toast";
import { useIsMobile } from "@/lib/responsive";
import {
  STATUS_LABEL,
  STATUS_COLOR,
  displayStatusOf,
  isClosedBusiness,
  scoreColor,
  scoreLabel,
  googleMapsUrl,
} from "@/lib/prospectStatus";
import { attemptsFromProps } from "@/lib/prospectHistory";
import { useScrollLock } from "@/lib/useScrollLock";
import { logNoAnswer, markNotOurTarget, markNotInterested, addProspectNote, revertProspect } from "@/lib/prospectActions";
import ProspectTimeline from "@/components/prospecting/ProspectTimeline";
import ConvertModal, { type ConvertOptions } from "@/components/prospecting/ConvertModal";

export default function ProspectDetailDrawer({
  prospect,
  onClose,
  onConvert,
  onUpdated,
  onSetCategory,
  onAddPurpose,
  onRemovePurpose,
  onSaveProps,
}: {
  prospect: Prospect;
  onClose: () => void;
  /** Konwersja przez endpoint API (modal wybiera etap/źródło). */
  onConvert: (p: Prospect, opts: ConvertOptions) => Promise<string | null>;
  /** Propagacja zaktualizowanego rekordu do listy na stronie. */
  onUpdated: (p: Prospect) => void;
  onSetCategory: (p: Prospect, categoryKey: string) => Promise<void>;
  onAddPurpose: (p: Prospect, purposeKey: string) => Promise<void>;
  onRemovePurpose: (p: Prospect, purposeKey: string) => Promise<void>;
  onSaveProps: (p: Prospect, props: Record<string, unknown>) => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const isMobile = useIsMobile(860);
  const { categories, purposes } = useClassification();
  const { customViews } = useEntityProperties("prospects");
  useScrollLock();
  const p = prospect;

  const display = displayStatusOf(p);
  const closed = isClosedBusiness(p);
  const attempts = attemptsFromProps(p.props);

  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deal, setDeal] = useState<{ id: string; name: string | null; stage: string } | null>(null);

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
      if (e.key === "Escape" && !convertOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, convertOpen]);

  // ── Akcje statusu (identyczna semantyka jak w trybie dzwonienia) ────────
  async function handleNoAnswer() {
    if (busy) return;
    setBusy(true);
    const res = await logNoAnswer(supabase, p);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zapisać próby kontaktu.");
      return;
    }
    onUpdated(res.updated);
    const n = attemptsFromProps(res.updated.props);
    toast.undo(`Nie odbiera — ${n}. próba`, async () => {
      const restored = await revertProspect(supabase, p.id, res.snapshot);
      if (restored) onUpdated(restored);
    });
  }

  async function handleNotOurTarget() {
    if (busy) return;
    setBusy(true);
    const res = await markNotOurTarget(supabase, p);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return;
    }
    onUpdated(res.updated);
    toast.undo("Nie nasz target — zarchiwizowano", async () => {
      const restored = await revertProspect(supabase, p.id, res.snapshot);
      if (restored) onUpdated(restored);
    });
  }

  async function handleNotInterested() {
    if (busy) return;
    setBusy(true);
    const res = await markNotInterested(supabase, p);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return;
    }
    onUpdated(res.updated);
    toast.undo("Niezainteresowany — zarchiwizowano", async () => {
      const restored = await revertProspect(supabase, p.id, res.snapshot);
      if (restored) onUpdated(restored);
    });
  }

  async function handleAddNote(body: string) {
    const res = await addProspectNote(supabase, p, body);
    if (!res) {
      toast.error("Nie udało się zapisać notatki.");
      return;
    }
    onUpdated(res.updated);
  }

  async function handleConvert(opts: ConvertOptions) {
    const dealId = await onConvert(p, opts);
    if (dealId) setConvertOpen(false);
    return dealId;
  }

  // Zapis pojedynczej właściwości własnej (inline).
  async function savePropValue(key: string, value: unknown) {
    const next = { ...(p.props ?? {}) };
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = typeof value === "string" ? value.trim() : value;
    await onSaveProps(p, next);
  }

  const canAct = !closed && (display === "new" || display === "no_answer");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 70 }} />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="selltic-admin"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(760px, 100vw)",
          background: tokens.card,
          borderLeft: `1px solid ${tokens.border}`,
          boxShadow: "-16px 0 48px rgba(15,18,28,0.14)",
          zIndex: 71,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Nagłówek ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: `1px solid ${tokens.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </h2>
            <div style={{ fontSize: 12, color: tokens.muted, marginTop: 1 }}>
              {[p.industry, p.city].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          {canAct && (
            <button onClick={() => setConvertOpen(true)} style={{ ...primaryButton, background: tokens.success }}>
              <MIcon name="check_circle" size={15} /> Konwertuj na lead
            </button>
          )}
          <button onClick={onClose} aria-label="Zamknij" style={{ width: 28, height: 28, borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", color: tokens.muted, flexShrink: 0 }}>
            <MIcon name="close" size={16} />
          </button>
        </div>

        {/* ── Dwie kolumny ── */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row" }}>
          {/* Lewa: właściwości */}
          <div
            className="selltic-scroll-y"
            style={{
              width: isMobile ? "100%" : 340,
              flexShrink: 0,
              borderRight: isMobile ? "none" : `1px solid ${tokens.borderSoft}`,
              borderBottom: isMobile ? `1px solid ${tokens.borderSoft}` : "none",
              overflowY: "auto",
              padding: 16,
              background: tokens.surface,
            }}
          >
            {/* Aktualny status (tylko wyświetlanie) — oddzielony od akcji */}
            <section style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, margin: "0 0 8px" }}>
                Aktualny status
              </h3>
              <div style={{ ...menuPanel, boxShadow: "none", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 11px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    background: `${STATUS_COLOR[display]}14`,
                    color: STATUS_COLOR[display],
                    border: `1px solid ${STATUS_COLOR[display]}30`,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[display] }} />
                  {STATUS_LABEL[display]}
                </span>
                {p.archived_at && <span style={{ fontSize: 11.5, color: tokens.muted }}>w Archiwum</span>}
                {closed && (
                  <span style={{ fontSize: 12, color: tokens.danger, fontWeight: 600, marginLeft: "auto" }}>
                    Firma zamknięta — nie kontaktuj
                  </span>
                )}
              </div>
            </section>

            {/* Akcje zmiany statusu — osobna sekcja pod statusem */}
            {canAct && (
              <section style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, margin: "0 0 8px" }}>
                  Zmień status
                </h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={handleNoAnswer}
                    disabled={busy}
                    style={{ ...ghostButton, borderColor: `${tokens.warning}55`, color: tokens.warning, fontWeight: 600 }}
                  >
                    <MIcon name="phone_missed" size={15} /> Nie odbiera
                  </button>
                  <button
                    onClick={handleNotInterested}
                    disabled={busy}
                    style={{ ...ghostButton, borderColor: `${tokens.danger}45`, color: tokens.danger, fontWeight: 600 }}
                  >
                    <MIcon name="thumb_down" size={15} /> Niezainteresowany
                  </button>
                  <button
                    onClick={handleNotOurTarget}
                    disabled={busy}
                    style={{ ...ghostButton }}
                  >
                    <MIcon name="block" size={15} /> Nie nasz target
                  </button>
                </div>
              </section>
            )}

            {/* Metryki */}
            <Group title="Kontakt">
              <PropRow label="Próby kontaktu">
                <span style={{ fontWeight: 600, color: attempts > 0 ? tokens.warning : tokens.text }}>{attempts}</span>
              </PropRow>
              {deal && (
                <PropRow label="Deal">
                  <a href={`/admin/leads/${deal.id}`} style={{ color: tokens.accent, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {deal.name || "Bez nazwy"} <MIcon name="open_in_new" size={12} />
                  </a>
                </PropRow>
              )}
            </Group>

            {/* Klasyfikacja — kategoria (jednokrotny wybór) + cele kontaktu
                (wielokrotne, z możliwością usuwania pojedynczych chipów). */}
            <section style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, margin: "0 0 8px" }}>
                Klasyfikacja
              </h3>
              <div style={{ ...menuPanel, boxShadow: "none", padding: 12, display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 5 }}>
                  <span style={{ fontSize: 12, color: tokens.muted, fontWeight: 500 }}>Kategoria</span>
                  <select value={p.category ?? ""} onChange={(e) => onSetCategory(p, e.target.value)} style={inputStyle}>
                    <option value="">— brak —</option>
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: tokens.muted, fontWeight: 500 }}>Cel kontaktu</span>
                  {(p.purposes ?? []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {(p.purposes ?? []).map((k) => {
                        const meta = purposes.find((x) => x.key === k);
                        const color = meta?.color ?? tokens.muted;
                        return (
                          <span
                            key={k}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, padding: "3px 6px 3px 9px", borderRadius: 6, background: `${color}14`, color, border: `1px solid ${color}2E` }}
                          >
                            {meta?.label ?? k}
                            <button
                              onClick={() => onRemovePurpose(p, k)}
                              aria-label={`Usuń cel ${meta?.label ?? k}`}
                              title="Usuń"
                              style={{ border: "none", background: "none", cursor: "pointer", color, display: "grid", placeItems: "center", padding: 0, lineHeight: 0 }}
                            >
                              <MIcon name="close" size={13} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.currentTarget.value = "";
                      if (v) onAddPurpose(p, v);
                    }}
                    style={inputStyle}
                  >
                    <option value="">Dodaj cel kontaktu…</option>
                    {purposes
                      .filter((pp) => !(p.purposes ?? []).includes(pp.key))
                      .map((pp) => (
                        <option key={pp.key} value={pp.key}>
                          {pp.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Dane firmy (Google Maps) */}
            <Group title="Dane firmy">
              <PropRow label="Telefon">
                {p.phone ? (
                  <a href={`tel:${p.phone}`} style={{ color: tokens.accent, fontWeight: 600, textDecoration: "none" }}>
                    {p.phone}
                  </a>
                ) : (
                  "—"
                )}
              </PropRow>
              <PropRow label="Ocena">
                {p.rating != null ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <MIcon name="star" size={13} fill color={tokens.warning} /> {p.rating.toFixed(1)} ({p.review_count ?? 0})
                  </span>
                ) : (
                  "—"
                )}
              </PropRow>
              <PropRow label="Strona">
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent, textDecoration: "none", wordBreak: "break-all", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {p.website.replace(/^https?:\/\//, "")} <MIcon name="open_in_new" size={11} />
                  </a>
                ) : (
                  <span style={{ color: tokens.success, fontWeight: 600 }}>Brak strony</span>
                )}
              </PropRow>
              <PropRow label="Adres">{p.address || "—"}</PropRow>
              <PropRow label="Miasto">{p.city || "—"}</PropRow>
              <PropRow label="Branża">{p.industry || "—"}</PropRow>
              <PropRow label="Status firmy">{p.business_status || "—"}</PropRow>
              {p.lead_score != null && (
                <PropRow label="Score">
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "1px 8px", borderRadius: 6, background: `${scoreColor(p.lead_score)}14`, color: scoreColor(p.lead_score) }}>
                    {p.lead_score} · {scoreLabel(p.lead_score)}
                  </span>
                </PropRow>
              )}
              <PropRow label="Źródło">{p.source || "—"}</PropRow>
              <a
                href={googleMapsUrl(p)}
                target="_blank"
                rel="noreferrer"
                style={{ ...ghostButton, textDecoration: "none", marginTop: 8, alignSelf: "flex-start" }}
              >
                <MIcon name="location_on" size={15} color={tokens.accent} /> Google Maps
              </a>
            </Group>

            {/* Właściwości własne — edycja inline */}
            {customViews.length > 0 && (
              <Group title="Właściwości">
                {customViews.map((v) => (
                  <PropRow key={v.key} label={v.label}>
                    <InlineProp
                      view={v}
                      value={(p.props ?? {})[v.key]}
                      onCommit={(val) => savePropValue(v.key, val)}
                    />
                  </PropRow>
                ))}
              </Group>
            )}
          </div>

          {/* Prawa: oś czasu */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 16, display: "flex", flexDirection: "column" }}>
            <ProspectTimeline prospect={p} onAddNote={handleAddNote} />
          </div>
        </div>
      </motion.div>

      {convertOpen && <ConvertModal prospect={p} onClose={() => setConvertOpen(false)} onConvert={handleConvert} />}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, margin: "0 0 8px" }}>
        {title}
      </h3>
      <div style={{ ...menuPanel, boxShadow: "none", padding: "4px 12px 10px", display: "grid" }}>{children}</div>
    </section>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${tokens.borderSoft}`, fontSize: 13 }}>
      <span style={{ width: 104, flexShrink: 0, fontSize: 12, color: tokens.muted, fontWeight: 500, paddingTop: 2 }}>{label}</span>
      <span style={{ minWidth: 0, flex: 1, color: tokens.text }}>{children}</span>
    </div>
  );
}

// Edycja inline pojedynczej właściwości: pola tekstowe zapisują na blur,
// listy/checkboxy natychmiast po zmianie.
function InlineProp({
  view,
  value,
  onCommit,
}: {
  view: Parameters<typeof PropertyValueInput>[0]["view"];
  value: unknown;
  onCommit: (value: unknown) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<unknown>(value);
  useEffect(() => setDraft(value), [value]);

  const immediate = view.type === "select" || view.type === "multi_select" || view.type === "boolean";

  return (
    <div
      onBlur={() => {
        if (!immediate && JSON.stringify(draft ?? null) !== JSON.stringify(value ?? null)) onCommit(draft);
      }}
    >
      <PropertyValueInput
        view={view}
        value={draft}
        onChange={(val) => {
          setDraft(val);
          if (immediate) onCommit(val);
        }}
      />
    </div>
  );
}
