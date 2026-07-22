// components/prospecting/CallingMode.tsx — „Tryb dzwonienia" (pełny redesign
// wg szkicu): górny pasek na całą szerokość (tytuł · postęp · wyjście), niżej
// dwie kolumny — karta firmy (lewa) i notatki + TRWAŁA historia kontaktu
// (prawa). Pasek akcji na dole ze skrótami klawiszowymi i cofaniem.
// Historia jest zapisywana na prospekcie (props.history) — nie znika po
// zamknięciu sesji.
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import { useToast } from "@/components/Toast";
import type { Prospect } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";
import { CategoryBadge, PurposeBadges } from "@/components/ClassificationBadges";
import { googleMapsUrl } from "@/lib/prospectStatus";
import { attemptsFromProps, type ProspectSnapshot } from "@/lib/prospectHistory";
import { useScrollLock } from "@/lib/useScrollLock";
import { logNoAnswer, markNotOurTarget, markNotInterested, addProspectNote, revertProspect } from "@/lib/prospectActions";
import ProspectTimeline from "@/components/prospecting/ProspectTimeline";
import ConvertModal, { type ConvertOptions } from "@/components/prospecting/ConvertModal";

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

// Wpis stosu cofania: pozycja w kolejce + migawka do pełnego odwrócenia akcji
// (null dla „Pomiń" — nic nie zapisał). Konwersji nie cofamy (deal już
// istnieje; przed pomyłką chroni modal potwierdzenia).
type UndoEntry = {
  index: number;
  prospectId: string;
  label: string;
  snapshot: ProspectSnapshot | null;
};

export default function CallingMode({
  prospects,
  onClose,
  onConvert,
  onProspectUpdated,
}: {
  prospects: Prospect[];
  onClose: () => void;
  /** Konwersja przez endpoint API (modal przekazuje etap/źródło). */
  onConvert: (p: Prospect, opts: ConvertOptions) => Promise<string | null>;
  /** Propagacja zaktualizowanego rekordu do listy na stronie. */
  onProspectUpdated: (p: Prospect) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const isMobile = useIsMobile(900);
  useScrollLock();

  // Kolejka jest migawką z momentu otwarcia, ale rekordy w niej podmieniamy
  // po każdej akcji (żeby historia/licznik prób były aktualne przy cofnięciu).
  const [queue, setQueue] = useState<Prospect[]>(prospects);
  const [index, setIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converted, setConverted] = useState(0);

  const total = queue.length;
  const current = index < total ? queue[index] : null;
  const done = index >= total;

  function patchQueue(updated: Prospect) {
    setQueue((q) => q.map((x) => (x.id === updated.id ? updated : x)));
    onProspectUpdated(updated);
  }

  function pushUndo(entry: UndoEntry) {
    setUndoStack((s) => [...s, entry]);
  }

  async function undoLast() {
    if (busy) return;
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setBusy(true);
    if (entry.snapshot) {
      const restored = await revertProspect(supabase, entry.prospectId, entry.snapshot);
      if (!restored) {
        toast.error("Nie udało się cofnąć akcji.");
        setBusy(false);
        return;
      }
      patchQueue(restored);
    }
    setUndoStack((s) => s.slice(0, -1));
    setIndex(entry.index);
    setBusy(false);
    toast.info(`Cofnięto: ${entry.label}`);
  }

  // Cofnięcie KONKRETNEJ akcji z toasta (Gmail-style) — działa także, gdy w
  // międzyczasie doszły kolejne; usuwa wpis ze stosu po id.
  async function undoFromToast(entry: UndoEntry) {
    if (entry.snapshot) {
      const restored = await revertProspect(supabase, entry.prospectId, entry.snapshot);
      if (!restored) {
        toast.error("Nie udało się cofnąć akcji.");
        return;
      }
      patchQueue(restored);
    }
    setUndoStack((s) => {
      const i = s.lastIndexOf(entry);
      return i === -1 ? s : [...s.slice(0, i), ...s.slice(i + 1)];
    });
    setIndex(entry.index);
  }

  function handleSkip() {
    if (!current || busy) return;
    const entry: UndoEntry = { index, prospectId: current.id, label: "Pominięto", snapshot: null };
    pushUndo(entry);
    setIndex((i) => i + 1);
    toast.undo(`Pominięto: ${current.name}`, () => undoFromToast(entry));
  }

  async function handleNoAnswer() {
    if (!current || busy) return;
    setBusy(true);
    const res = await logNoAnswer(supabase, current);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zapisać próby kontaktu.");
      return;
    }
    const entry: UndoEntry = { index, prospectId: current.id, label: "Nie odbiera", snapshot: res.snapshot };
    pushUndo(entry);
    patchQueue(res.updated);
    setIndex((i) => i + 1);
    const attempt = attemptsFromProps(res.updated.props);
    toast.undo(`Nie odbiera (${attempt}. próba): ${current.name}`, () => undoFromToast(entry));
  }

  async function handleNotOurTarget() {
    if (!current || busy) return;
    setBusy(true);
    const res = await markNotOurTarget(supabase, current);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return;
    }
    const entry: UndoEntry = { index, prospectId: current.id, label: "Nie nasz target", snapshot: res.snapshot };
    pushUndo(entry);
    patchQueue(res.updated);
    setIndex((i) => i + 1);
    toast.undo(`Nie nasz target (zarchiwizowano): ${current.name}`, () => undoFromToast(entry));
  }

  async function handleNotInterested() {
    if (!current || busy) return;
    setBusy(true);
    const res = await markNotInterested(supabase, current);
    setBusy(false);
    if (!res) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return;
    }
    const entry: UndoEntry = { index, prospectId: current.id, label: "Niezainteresowany", snapshot: res.snapshot };
    pushUndo(entry);
    patchQueue(res.updated);
    setIndex((i) => i + 1);
    toast.undo(`Niezainteresowany (zarchiwizowano): ${current.name}`, () => undoFromToast(entry));
  }

  async function handleConvert(opts: ConvertOptions) {
    if (!current) return null;
    setBusy(true);
    const dealId = await onConvert(current, opts);
    setBusy(false);
    if (dealId) {
      setConvertOpen(false);
      setConverted((c) => c + 1);
      setIndex((i) => i + 1);
      toast.success(`Deal utworzony: ${opts.name}`);
    }
    return dealId;
  }

  async function handleAddNote(body: string) {
    if (!current) return;
    const res = await addProspectNote(supabase, current, body);
    if (!res) {
      toast.error("Nie udało się zapisać notatki.");
      return;
    }
    patchQueue(res.updated);
    toast.success("Notatka zapisana.");
  }

  // ── Skróty klawiszowe: N / T / K / Spacja / Backspace / Esc ─────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "Escape") {
        if (convertOpen) setConvertOpen(false);
        else onClose();
        return;
      }
      if (typing || convertOpen || done) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        handleNoAnswer();
      } else if (k === "i") {
        e.preventDefault();
        handleNotInterested();
      } else if (k === "t") {
        e.preventDefault();
        handleNotOurTarget();
      } else if (k === "k") {
        e.preventDefault();
        if (current) setConvertOpen(true);
      } else if (e.key === " ") {
        e.preventDefault();
        handleSkip();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undoLast();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy, convertOpen, done, undoStack, index]);

  const attempts = current ? attemptsFromProps(current.props) : 0;

  return (
    <div
      className="selltic-admin"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: tokens.bg, display: "flex", flexDirection: "column" }}
    >
      {/* ── Górny pasek: tytuł · postęp · wyjście ── */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "10px 16px",
          background: tokens.card,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
          <MIcon name="call" size={17} color={tokens.accent} />
          Tryb dzwonienia
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: tokens.muted }}>
          {done ? `${total} z ${total} prospektów` : `${index + 1} z ${total} prospektów`}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            aria-label="Zamknij tryb dzwonienia"
            title="Zamknij (Esc)"
            style={{ width: 28, height: 28, borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", color: tokens.muted }}
          >
            <MIcon name="close" size={17} />
          </button>
        </div>
      </div>

      {/* ── Dwie kolumny: karta firmy · notatki + historia ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
        {/* Lewa: karta firmy */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", alignItems: done ? "center" : "flex-start", justifyContent: "center", padding: isMobile ? 14 : 28 }}>
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="summary"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{ textAlign: "center", maxWidth: 400 }}
              >
                <MIcon name="flag_circle" size={44} color={tokens.success} />
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: "10px 0 6px" }}>Sesja zakończona</h2>
                <p style={{ fontSize: 13.5, color: tokens.muted, margin: "0 0 18px" }}>
                  Przeszliście przez {total} prospektów · {converted} {converted === 1 ? "konwersja" : "konwersji"}.
                </p>
                <button
                  onClick={onClose}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: tokens.radiusSm, border: "none", background: tokens.accent, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
                >
                  Wróć do listy
                </button>
              </motion.div>
            ) : current ? (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                style={{
                  width: "min(560px, 100%)",
                  background: tokens.card,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: tokens.radius,
                  padding: isMobile ? 18 : 28,
                  boxShadow: "0 1px 3px rgba(15,18,28,0.05)",
                }}
              >
                {/* Nazwa + kategoria/branża */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>{current.name}</div>
                  <div style={{ fontSize: 12.5, color: tokens.muted, marginTop: 3 }}>
                    {[current.industry, current.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {(current.category || (current.purposes ?? []).length > 0) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", marginTop: 8 }}>
                      {current.category && <CategoryBadge categoryKey={current.category} size="sm" />}
                      <PurposeBadges purposeKeys={current.purposes} size="sm" />
                    </div>
                  )}

                  {/* Telefon — duży, klikalny */}
                  {current.phone ? (
                    <a
                      href={`tel:${current.phone}`}
                      style={{ display: "block", fontSize: isMobile ? 30 : 38, fontWeight: 700, letterSpacing: "-0.01em", color: tokens.accent, margin: "18px 0 4px", textDecoration: "none", wordBreak: "break-word", fontVariantNumeric: "tabular-nums" }}
                    >
                      {current.phone}
                    </a>
                  ) : (
                    <div style={{ fontSize: 20, fontWeight: 600, color: tokens.muted, margin: "18px 0 4px" }}>Brak numeru</div>
                  )}
                  {attempts > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: tokens.warning }}>
                      Próby kontaktu: {attempts}
                    </div>
                  )}
                </div>

                {/* Dane z Google Maps (kolejność wg specyfikacji) */}
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${tokens.borderSoft}`, display: "grid", gap: 7 }}>
                  <InfoRow label="Ocena">
                    {current.rating != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <MIcon name="star" size={14} fill color={tokens.warning} />
                        {current.rating.toFixed(1)} ({current.review_count ?? 0} opinii)
                      </span>
                    ) : (
                      "—"
                    )}
                  </InfoRow>
                  <InfoRow label="Adres">{current.address || "—"}</InfoRow>
                  <InfoRow label="Strona">
                    {current.website ? (
                      <a href={current.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent, display: "inline-flex", gap: 5, alignItems: "center", wordBreak: "break-all" }}>
                        <MIcon name="language" size={13} /> {current.website.replace(/^https?:\/\//, "")}
                        <MIcon name="open_in_new" size={11} />
                      </a>
                    ) : (
                      <span style={{ color: tokens.success, fontWeight: 600 }}>Brak strony</span>
                    )}
                    {current.website_status && current.website && (
                      <span style={{ color: tokens.muted }}> · {WEBSITE_STATUS_LABEL[current.website_status] ?? current.website_status}</span>
                    )}
                  </InfoRow>
                  <InfoRow label="Miasto">{current.city || "—"}</InfoRow>
                  <InfoRow label="Status firmy">{current.business_status || "—"}</InfoRow>
                  <InfoRow label="Źródło">{current.source || "—"}</InfoRow>
                </div>

                <div style={{ textAlign: "center" }}>
                  <a
                    href={googleMapsUrl(current)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, fontWeight: 500, fontSize: 13, textDecoration: "none", marginTop: 16 }}
                  >
                    <MIcon name="location_on" size={15} color={tokens.accent} /> Otwórz w Google Maps
                  </a>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Prawa: notatki + trwała historia kontaktu */}
        {!done && current && (
          <div
            style={{
              flexShrink: 0,
              width: isMobile ? "100%" : 360,
              maxHeight: isMobile ? 260 : "none",
              borderTop: isMobile ? `1px solid ${tokens.border}` : "none",
              borderLeft: isMobile ? "none" : `1px solid ${tokens.border}`,
              background: tokens.card,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <ProspectTimeline prospect={current} onAddNote={handleAddNote} />
          </div>
        )}
      </div>

      {/* ── Pasek akcji ── */}
      {!done && current && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 8,
            padding: "10px 16px",
            background: tokens.card,
            borderTop: `1px solid ${tokens.border}`,
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <ActionButton
            icon="skip_next"
            label="Pomiń"
            hint="Spacja"
            onClick={handleSkip}
            disabled={busy}
            style={{ flex: isMobile ? "1 1 46%" : 0.8, background: "#fff", color: tokens.text, border: `1px solid ${tokens.border}` }}
          />
          <ActionButton
            icon="undo"
            label="Cofnij"
            hint="⌫"
            onClick={undoLast}
            disabled={busy || undoStack.length === 0}
            style={{ flex: isMobile ? "1 1 46%" : 0.8, background: "#fff", color: undoStack.length === 0 ? tokens.muted : tokens.text, border: `1px solid ${tokens.border}` }}
          />
          <ActionButton
            icon="phone_missed"
            label="Nie odbiera"
            hint="N"
            onClick={handleNoAnswer}
            disabled={busy}
            style={{ flex: isMobile ? "1 1 46%" : 1, background: tokens.warning, color: "#fff", border: "1px solid transparent" }}
          />
          <ActionButton
            icon="thumb_down"
            label="Niezainteresowany"
            hint="I"
            onClick={handleNotInterested}
            disabled={busy}
            style={{ flex: isMobile ? "1 1 46%" : 1, background: tokens.danger, color: "#fff", border: "1px solid transparent" }}
          />
          <ActionButton
            icon="block"
            label="Nie nasz target"
            hint="T"
            onClick={handleNotOurTarget}
            disabled={busy}
            style={{ flex: isMobile ? "1 1 46%" : 1, background: "#fff", color: tokens.text, border: `1px solid ${tokens.border}` }}
          />
          <ActionButton
            icon="check_circle"
            label="Konwertuj na lead"
            hint="K"
            onClick={() => setConvertOpen(true)}
            disabled={busy}
            style={{ flex: isMobile ? "1 1 100%" : 1.4, background: tokens.success, color: "#fff", border: "1px solid transparent", fontWeight: 600 }}
          />
        </div>
      )}

      {convertOpen && current && (
        <ConvertModal prospect={current} onClose={() => setConvertOpen(false)} onConvert={handleConvert} />
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  style,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "10px 14px",
        borderRadius: tokens.radiusSm,
        fontSize: 13.5,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      <MIcon name={icon} size={17} />
      {label}
      <kbd
        style={{
          fontFamily: "inherit",
          fontSize: 10.5,
          fontWeight: 600,
          padding: "1px 5px",
          borderRadius: 4,
          background: "rgba(0,0,0,0.10)",
          border: "1px solid rgba(255,255,255,0.25)",
          opacity: 0.85,
          marginLeft: 2,
        }}
      >
        {hint}
      </kbd>
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13, textAlign: "left" }}>
      <span style={{ width: 96, flexShrink: 0, color: tokens.muted, fontWeight: 500 }}>{label}</span>
      <span style={{ minWidth: 0, color: tokens.text }}>{children}</span>
    </div>
  );
}
