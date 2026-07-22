// components/PageHeader.tsx — kanoniczny nagłówek strony panelu admina.
// Jeden układ na każdym widoku: tytuł (font.title) po lewej, opcjonalny opis
// pod nim, opcjonalna akcja główna w prawym górnym rogu, a pod spodem —
// opcjonalny rząd zakładek. Ten sam rytm pionowy wszędzie (marginBottom).
// Zastępuje ręcznie pisane <h1 style={{fontSize:18,...}}> rozsypane po stronach.
"use client";

import type { CSSProperties, ReactNode } from "react";
import { tokens, font, space } from "@/lib/ui";

export default function PageHeader({
  title,
  description,
  actions,
  tabs,
  /** Zdejmuje dolny margines — gdy nagłówek żyje w kontenerze o własnym rytmie. */
  flush = false,
  style,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Akcja(-e) główna po prawej stronie tytułu (zwykle jeden przycisk primary). */
  actions?: ReactNode;
  /** Rząd zakładek renderowany pod tytułem (np. <ViewTabs />). */
  tabs?: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ marginBottom: flush ? 0 : space.section, ...style }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: space.md,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ ...font.title, margin: 0, color: tokens.text }}>{title}</h1>
          {description && (
            <p style={{ ...font.secondary, margin: "4px 0 0", color: tokens.muted, maxWidth: 640 }}>
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {tabs && <div style={{ marginTop: space.md }}>{tabs}</div>}
    </div>
  );
}
