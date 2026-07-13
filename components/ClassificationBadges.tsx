// components/ClassificationBadges.tsx — spójne badge'y klasyfikacji leada:
// KATEGORIA branży (Feature 1, jednowartościowa) i CELE KONTAKTU (Feature 2,
// wielowartościowe). Kolory i etykiety pochodzą z kontekstu useClassification,
// więc badge zawsze renderuje aktualną nazwę/kolor po kluczu.
"use client";

import { useClassification } from "@/lib/classification";

function pill(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.3,
    color,
    background: `${color}1A`,
    border: `1px solid ${color}33`,
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

// Badge kategorii branży (pojedynczy). Zwraca „—”, gdy brak kategorii.
export function CategoryBadge({
  categoryKey,
  size = "md",
}: {
  categoryKey: string | null | undefined;
  size?: "sm" | "md";
}) {
  const { categoryMeta } = useClassification();
  const meta = categoryMeta(categoryKey);
  if (!meta) return <span style={{ color: "#8A92A6" }}>—</span>;
  const fs = size === "sm" ? 11 : 12;
  return (
    <span style={{ ...pill(meta.color), fontSize: fs }} title={meta.label}>
      {meta.label}
    </span>
  );
}

// Badge'y celów kontaktu (wielowartościowe). Zwraca „—”, gdy brak.
export function PurposeBadges({
  purposeKeys,
  size = "md",
}: {
  purposeKeys: string[] | null | undefined;
  size?: "sm" | "md";
}) {
  const { purposeMeta } = useClassification();
  const keys = (purposeKeys ?? []).filter(Boolean);
  if (keys.length === 0) return <span style={{ color: "#8A92A6" }}>—</span>;
  const fs = size === "sm" ? 11 : 12;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5 }}>
      {keys.map((k) => {
        const meta = purposeMeta(k);
        const label = meta?.label ?? k;
        const color = meta?.color ?? "#1A73E7";
        return (
          <span key={k} style={{ ...pill(color), fontSize: fs }} title={label}>
            {label}
          </span>
        );
      })}
    </span>
  );
}
