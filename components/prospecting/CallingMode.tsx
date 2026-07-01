// components/prospecting/CallingMode.tsx — „Tryb dzwonienia”: pełnoekranowy,
// jeden prospekt naraz, styl Tinder. Kolejka jest migawką z momentu otwarcia
// (nie przeskakuje pod nogami, gdy status się zmienia).
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, SkipForward, PhoneOff, Ban, CheckCircle2, Globe, Star, ExternalLink, StickyNote } from "lucide-react";
import { tokens } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import type { Prospect } from "@/lib/types";
import { ScoreBreakdownList } from "@/components/ScoreBreakdown";
import {
  scoreColor,
  scoreLabel,
  googleMapsUrl,
  notesFromProps,
  type WritableDisplayStatus,
} from "@/lib/prospectStatus";

// Etykiety statusu strony (te same wartości co w widoku Prospecting).
const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

type HistoryAction = "Pominięto" | "Nie odbiera" | "Niezainteresowany" | "Skonwertowano";

type HistoryEntry = {
  id: string;
  name: string;
  action: HistoryAction;
  at: string;
};

export default function CallingMode({
  prospects,
  onClose,
  onConvert,
  onSetStatus,
}: {
  prospects: Prospect[];
  onClose: () => void;
  onConvert: (p: Prospect) => Promise<string | null>;
  onSetStatus: (p: Prospect, status: WritableDisplayStatus) => Promise<boolean>;
}) {
  const router = useRouter();
  const isMobile = useIsMobile(860);
  const [queue] = useState<Prospect[]>(prospects);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const total = queue.length;
  const current = index < total ? queue[index] : null;
  const done = index >= total;

  const notes = useMemo(() => (current ? notesFromProps(current.props) : []), [current]);

  function pushHistory(p: Prospect, action: HistoryAction) {
    setHistory((h) => [{ id: p.id, name: p.name, action, at: new Date().toISOString() }, ...h]);
  }

  function advance() {
    setIndex((i) => i + 1);
  }

  function handleSkip() {
    if (!current || busy) return;
    pushHistory(current, "Pominięto");
    advance();
  }

  async function handleAction(kind: "no_answer" | "not_interested" | "convert") {
    if (!current || busy) return;
    setBusy(true);
    if (kind === "convert") {
      const dealId = await onConvert(current);
      setBusy(false);
      if (dealId) {
        pushHistory(current, "Skonwertowano");
        // Od razu na stronę nowego deala — można dodać notatkę, termin spotkania
        // i dane, póki rozmowa jest świeża. Powrót do dzwonienia: ?from=calling.
        router.push(`/admin/leads/${dealId}?from=calling`);
      }
      return;
    }
    const ok = await onSetStatus(current, kind);
    setBusy(false);
    if (ok) {
      pushHistory(current, kind === "no_answer" ? "Nie odbiera" : "Niezainteresowany");
      advance();
    }
  }

  const converted = history.filter((h) => h.action === "Skonwertowano").length;
  const noAnswer = history.filter((h) => h.action === "Nie odbiera").length;
  const notInterested = history.filter((h) => h.action === "Niezainteresowany").length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: tokens.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Górny pasek */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 22px",
          background: tokens.card,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15 }}>📞 Tryb dzwonienia</div>
        {!done && (
          <div style={{ fontSize: 13, fontWeight: 700, color: tokens.muted }}>
            {index + 1} z {total} prospektów
          </div>
        )}
        <button onClick={onClose} aria-label="Zamknij tryb dzwonienia" style={closeBtn}>
          <X size={18} color={tokens.muted} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row" }}>
        {/* Główna karta */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            overflowY: "auto",
          }}
        >
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="summary"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{ textAlign: "center", maxWidth: 420 }}
              >
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏁</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Sesja zakończona</h2>
                <p style={{ fontSize: 15, color: tokens.muted, margin: "0 0 24px" }}>
                  {converted} konwersji, {noAnswer} nie odbiera, {notInterested} niezainteresowanych
                </p>
                <button onClick={onClose} style={{ ...bigActionBtn(tokens.accent), width: "auto", padding: "12px 28px" }}>
                  Wróć do listy
                </button>
              </motion.div>
            ) : current ? (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                style={{
                  width: "min(520px, 100%)",
                  background: tokens.card,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 20,
                  padding: 28,
                  textAlign: "center",
                  boxShadow: "0 12px 40px rgba(15,18,28,0.08)",
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 800 }}>{current.name}</div>
                <div style={{ fontSize: 14, color: tokens.muted, marginTop: 4 }}>
                  {[current.industry, current.city].filter(Boolean).join(" · ") || "—"}
                </div>

                {current.phone ? (
                  <a
                    href={`tel:${current.phone}`}
                    style={{
                      display: "block",
                      fontSize: 40,
                      fontWeight: 800,
                      color: tokens.accent,
                      margin: "26px 0 6px",
                      textDecoration: "none",
                      wordBreak: "break-word",
                    }}
                  >
                    {current.phone}
                  </a>
                ) : (
                  <div style={{ fontSize: 22, fontWeight: 700, color: tokens.muted, margin: "26px 0 6px" }}>
                    Brak numeru
                  </div>
                )}

                {current.lead_score != null && (
                  <div style={{ margin: "22px 0" }}>
                    <div style={{ height: 10, borderRadius: 999, background: tokens.bg, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${current.lead_score}%`,
                          background: scoreColor(current.lead_score),
                          borderRadius: 999,
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: scoreColor(current.lead_score) }}>
                      Score: {current.lead_score} · {scoreLabel(current.lead_score)}
                    </div>
                    <div style={{ textAlign: "left", marginTop: 12 }}>
                      <ScoreBreakdownList
                        score={current.lead_score}
                        breakdown={current.lead_score_breakdown}
                        fallbackReasons={current.props?.score_reasons}
                        compact
                      />
                    </div>
                  </div>
                )}

                {/* Pełne dane prospektu — ten sam zakres co strona szczegółów,
                    żeby nie trzeba było wychodzić z trybu dzwonienia. */}
                <div
                  style={{
                    textAlign: "left",
                    marginTop: 22,
                    paddingTop: 18,
                    borderTop: `1px solid ${tokens.border}`,
                    display: "grid",
                    gap: 9,
                  }}
                >
                  <InfoRow label="Adres">{current.address || "—"}</InfoRow>
                  <InfoRow label="Strona">
                    {current.website ? (
                      <a
                        href={current.website}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: tokens.accent, display: "inline-flex", gap: 5, alignItems: "center", wordBreak: "break-all" }}
                      >
                        <Globe size={13} /> {current.website.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span style={{ color: tokens.success, fontWeight: 700 }}>Brak strony</span>
                    )}
                  </InfoRow>
                  {current.website_status && (
                    <InfoRow label="Status strony">
                      {WEBSITE_STATUS_LABEL[current.website_status] ?? current.website_status}
                    </InfoRow>
                  )}
                  <InfoRow label="Ocena">
                    {current.rating != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Star size={13} fill={tokens.warning} color={tokens.warning} /> {current.rating.toFixed(1)} (
                        {current.review_count ?? 0} opinii)
                      </span>
                    ) : (
                      "—"
                    )}
                  </InfoRow>
                  <InfoRow label="Branża">{current.industry || "—"}</InfoRow>
                  <InfoRow label="Miasto">{current.city || "—"}</InfoRow>
                  <InfoRow label="Status firmy">{current.business_status || "—"}</InfoRow>
                  <InfoRow label="Źródło">{current.source || "—"}</InfoRow>
                  {notes.length > 0 && (
                    <InfoRow label="Notatki">
                      <div style={{ display: "grid", gap: 6 }}>
                        {notes
                          .slice()
                          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                          .map((n) => (
                            <div key={n.id} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                              <StickyNote size={12} color={tokens.muted} style={{ marginTop: 3, flexShrink: 0 }} />
                              <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
                            </div>
                          ))}
                      </div>
                    </InfoRow>
                  )}
                </div>

                <a
                  href={googleMapsUrl(current)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 16px",
                    borderRadius: 10,
                    background: tokens.accentSoft,
                    color: tokens.accent,
                    fontWeight: 700,
                    fontSize: 13,
                    textDecoration: "none",
                    marginTop: 18,
                  }}
                >
                  <MapPin size={15} /> Google Maps
                </a>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Historia sesji */}
        <div
          style={{
            flexShrink: 0,
            width: isMobile ? "100%" : 300,
            maxHeight: isMobile ? 220 : "none",
            borderTop: isMobile ? `1px solid ${tokens.border}` : "none",
            borderLeft: isMobile ? "none" : `1px solid ${tokens.border}`,
            background: tokens.card,
            padding: 18,
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, textTransform: "uppercase", marginBottom: 10 }}>
            Historia sesji
          </div>
          {history.length === 0 ? (
            <p style={{ fontSize: 13, color: tokens.muted }}>Jeszcze nic się nie wydarzyło.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {history.map((h, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>{h.name}</div>
                  <div style={{ color: tokens.muted }}>
                    {h.action} · {new Date(h.at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pasek akcji */}
      {!done && current && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 10,
            padding: 16,
            background: tokens.card,
            borderTop: `1px solid ${tokens.border}`,
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <button onClick={handleSkip} disabled={busy} style={{ ...bigActionBtn(tokens.muted, true), flex: isMobile ? "1 1 100%" : 1 }}>
            <SkipForward size={18} /> Pomiń
          </button>
          <button
            onClick={() => handleAction("no_answer")}
            disabled={busy}
            style={{ ...bigActionBtn(tokens.warning), flex: isMobile ? "1 1 45%" : 1 }}
          >
            <PhoneOff size={18} /> Nie odbiera
          </button>
          <button
            onClick={() => handleAction("not_interested")}
            disabled={busy}
            style={{ ...bigActionBtn(tokens.danger), flex: isMobile ? "1 1 45%" : 1 }}
          >
            <Ban size={18} /> Niezainteresowany
          </button>
          <button
            onClick={() => handleAction("convert")}
            disabled={busy}
            style={{ ...bigActionBtn(tokens.success), flex: isMobile ? "1 1 100%" : 1.6, fontSize: 16 }}
          >
            <CheckCircle2 size={20} /> Konwertuj na lead!
          </button>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13.5 }}>
      <span style={{ width: 104, flexShrink: 0, color: tokens.muted, fontWeight: 600 }}>{label}</span>
      <span style={{ minWidth: 0, color: tokens.text }}>{children}</span>
    </div>
  );
}

function bigActionBtn(color: string, ghost = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "16px 18px",
    borderRadius: 14,
    border: ghost ? `1px solid ${tokens.border}` : "none",
    background: ghost ? "#fff" : color,
    color: ghost ? tokens.text : "#fff",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
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
