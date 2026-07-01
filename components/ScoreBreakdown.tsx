// components/ScoreBreakdown.tsx — spójne pokazywanie lead score wraz z
// wyjaśnieniem (rozbiciem punktów) wszędzie tam, gdzie widoczny jest wynik.
//
// Dwa warianty:
// - <ScoreBadge>          kompaktowa pigułka z wynikiem + dymek na hover
//                         (listy/karty, gdzie nie ma miejsca na stałe rozbicie)
// - <ScoreBreakdownList>  zawsze widoczna lista pozycji + suma (widoki szczegółów)
//
// Oba korzystają z tego samego parseScoreBreakdown(), więc wyjaśnienie jest
// dokładnie takie, jak policzył scorer (spójne z wagami z scraper_config).
"use client";

import { useState } from "react";
import { tokens } from "@/lib/ui";
import {
  parseScoreBreakdown,
  formatBreakdownItem,
  formatBreakdownLine,
} from "@/lib/scoreBreakdown";

export function scoreColors(score: number): { color: string; bg: string } {
  if (score >= 70) return { color: tokens.success, bg: "rgba(24,169,87,0.10)" };
  if (score >= 35) return { color: tokens.warning, bg: "rgba(242,153,74,0.12)" };
  return { color: tokens.muted, bg: tokens.bg };
}

type CommonProps = {
  score: number | null;
  breakdown: unknown;
  fallbackReasons?: unknown;
};

// ── Kompaktowa pigułka z dymkiem na hover ──────────────────────────────────
export function ScoreBadge({
  score,
  breakdown,
  fallbackReasons,
  fontSize = 12.5,
}: CommonProps & { fontSize?: number }) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const parsed = parseScoreBreakdown(breakdown, fallbackReasons);
  const shown = score ?? parsed.total;
  const { color, bg } = scoreColors(shown ?? 0);
  const hasDetail = parsed.items.length > 0;
  // `title` = niezawodny natywny dymek (nie ucina się w kontenerach z overflow).
  const titleText = hasDetail ? formatBreakdownLine(parsed, score) : undefined;

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={(e) => {
        if (!hasDetail) return;
        const r = e.currentTarget.getBoundingClientRect();
        setCoords({ top: r.top, left: r.left + r.width / 2 });
      }}
      onMouseLeave={() => setCoords(null)}
    >
      <span
        title={titleText}
        style={{
          padding: "2px 10px",
          borderRadius: 999,
          fontSize,
          fontWeight: 700,
          color,
          background: bg,
          cursor: hasDetail ? "help" : "default",
          borderBottom: hasDetail ? `1px dotted ${color}` : undefined,
        }}
      >
        {shown ?? "—"}
      </span>

      {coords && hasDetail && (
        <div
          style={{
            position: "fixed",
            top: coords.top - 8,
            left: coords.left,
            transform: "translate(-50%, -100%)",
            zIndex: 1000,
            pointerEvents: "none",
            background: tokens.text,
            color: "#fff",
            borderRadius: 10,
            padding: "10px 12px",
            width: 250,
            boxShadow: "0 10px 30px rgba(15,18,28,0.28)",
          }}
        >
          <TooltipBody parsed={parsed} score={shown} />
        </div>
      )}
    </span>
  );
}

function TooltipBody({
  parsed,
  score,
}: {
  parsed: ReturnType<typeof parseScoreBreakdown>;
  score: number | null;
}) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, opacity: 0.85 }}>Jak liczony jest wynik</div>
      <div style={{ display: "grid", gap: 3 }}>
        {parsed.items.map((it, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ opacity: 0.92 }}>{it.label}</span>
            {it.points != null && (
              <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                {it.points > 0 ? "+" : ""}
                {it.points} pkt
              </span>
            )}
          </div>
        ))}
      </div>
      {score != null && (
        <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.18)", fontWeight: 800 }}>
          Razem: {score}/100
        </div>
      )}
    </div>
  );
}

// ── Zawsze widoczna lista (widoki szczegółów) ──────────────────────────────
export function ScoreBreakdownList({
  score,
  breakdown,
  fallbackReasons,
  compact = false,
}: CommonProps & { compact?: boolean }) {
  const parsed = parseScoreBreakdown(breakdown, fallbackReasons);
  if (parsed.items.length === 0) return null;
  const shown = score ?? parsed.total;

  return (
    <div style={{ display: "grid", gap: compact ? 3 : 5 }}>
      {parsed.items.map((it, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            fontSize: compact ? 12.5 : 13.5,
            color: tokens.text,
          }}
        >
          <span style={{ color: tokens.muted }}>{it.label}</span>
          {it.points != null && (
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: tokens.text }}>
              {it.points > 0 ? "+" : ""}
              {it.points} pkt
            </span>
          )}
        </div>
      ))}
      {shown != null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 3,
            paddingTop: 5,
            borderTop: `1px solid ${tokens.border}`,
            fontSize: compact ? 12.5 : 13.5,
            fontWeight: 800,
          }}
        >
          <span>Razem</span>
          <span>{shown}/100</span>
        </div>
      )}
    </div>
  );
}

// Pomocniczy wrapper, gdy potrzebny sam tekst (np. aria-label) — reeksport.
export function scoreExplanationText(
  score: number | null,
  breakdown: unknown,
  fallbackReasons?: unknown
): string {
  const parsed = parseScoreBreakdown(breakdown, fallbackReasons);
  return formatBreakdownLine(parsed, score);
}

// Re-eksport pozycji, gdyby ktoś chciał złożyć własny widok.
export { formatBreakdownItem };
