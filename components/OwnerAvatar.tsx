// components/OwnerAvatar.tsx — mały, okrągły awatar „Deal Ownera”.
// Zdjęcie profilowe (jeśli kiedyś dodane w lib/owners), inaczej kolorowe
// inicjały jako fallback — spójne per owner na wszystkich kartach.
"use client";

import { tokens } from "@/lib/ui";
import { ownerMeta } from "@/lib/owners";
import type { Assignee } from "@/lib/types";

export default function OwnerAvatar({
  assignee,
  size = 24,
  showName = false,
}: {
  assignee: Assignee | null | undefined;
  size?: number;
  showName?: boolean;
}) {
  const meta = ownerMeta(assignee);

  // Brak przypisania — dyskretny, neutralny placeholder.
  if (!meta) {
    return (
      <span
        title="Nieprzypisany"
        aria-label="Nieprzypisany"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          flexShrink: 0,
          display: "inline-grid",
          placeItems: "center",
          background: tokens.bg,
          border: `1px dashed ${tokens.border}`,
          color: tokens.muted,
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
        }}
      >
        ·
      </span>
    );
  }

  const circle = (
    <span
      title={meta.label}
      aria-label={`Deal Owner: ${meta.label}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-grid",
        placeItems: "center",
        overflow: "hidden",
        background: meta.avatar_url ? "transparent" : meta.color,
        color: "#fff",
        fontSize: Math.round(size * 0.46),
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {meta.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta.avatar_url}
          alt={meta.label}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        meta.initials
      )}
    </span>
  );

  if (!showName) return circle;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      {circle}
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: tokens.muted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {meta.label}
      </span>
    </span>
  );
}
