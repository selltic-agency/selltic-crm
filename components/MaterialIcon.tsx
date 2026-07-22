// components/MaterialIcon.tsx — JEDYNY zestaw ikon panelu admina: Material
// Symbols (Google), styl outlined, spójna waga. Renderuje ligaturę fontu
// zmiennego ładowanego w app/admin/shell.tsx. Publiczny renderer formularzy
// (components/FormRenderer.tsx) celowo NIE używa tego komponentu.
"use client";

import type { CSSProperties } from "react";

export default function MIcon({
  name,
  size = 18,
  color,
  fill = false,
  weight = 300,
  style,
  className,
  title,
}: {
  /** Nazwa ikony Material Symbols, np. "search", "call", "view_kanban". */
  name: string;
  size?: number;
  color?: string;
  /** Wypełniona odmiana (oś FILL) — np. aktywna pozycja nawigacji. */
  fill?: boolean;
  /** Waga kreski (oś wght); 300 = domyślna, spójna z resztą panelu. */
  weight?: number;
  style?: CSSProperties;
  className?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      aria-label={title}
      title={title}
      className={`msym${className ? ` ${className}` : ""}`}
      style={{
        fontSize: size,
        color: color ?? "currentColor",
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${
          size >= 40 ? 40 : size <= 20 ? 20 : 24
        }`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
