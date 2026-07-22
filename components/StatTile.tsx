// components/StatTile.tsx — kanoniczny kafel KPI (Analityka, Pulpit, podsumowania).
// Jedno traktowanie: kwadratowa ikona w miękkim tle akcentu, etykieta (font.meta,
// muted) i wartość (font.display). Stan ładowania = skeleton o rozmiarze wartości.
"use client";

import { tokens, font, cardStyle, space } from "@/lib/ui";
import MIcon from "@/components/MaterialIcon";

export default function StatTile({
  icon,
  label,
  value,
  /** Kolor ikony/tła — domyślnie akcent; przekaż token semantyczny dla wariantu. */
  tone = tokens.accent,
}: {
  icon: string;
  label: string;
  /** `null` → skeleton ładowania. */
  value: string | null;
  tone?: string;
}) {
  return (
    <div style={{ ...cardStyle(), display: "flex", alignItems: "center", gap: space.md }}>
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: tokens.radius,
          background: tone === tokens.accent ? tokens.accentSoft : `${tone}1A`,
          color: tone,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <MIcon name={icon} size={20} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...font.meta, color: tokens.muted }}>{label}</div>
        {value === null ? (
          <div
            style={{
              height: 24,
              width: 64,
              marginTop: 4,
              borderRadius: tokens.radiusSm,
              background: tokens.bg,
              animation: "selltic-skeleton 1.2s ease-in-out infinite",
            }}
          />
        ) : (
          <div style={{ ...font.display, color: tokens.text, marginTop: 2 }}>{value}</div>
        )}
      </div>
    </div>
  );
}
