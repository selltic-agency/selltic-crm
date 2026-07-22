// components/EmptyState.tsx — pusty stan w stylu Attio: mała ilustracja
// (szkic karty), krótki nagłówek, jedno zdanie opisu, akcja główna + boczna.
// Używany wszędzie tam, gdzie tabela/lista/kanban może być pusta.
"use client";

import type { ReactNode } from "react";
import { tokens, primaryButton, ghostButton } from "@/lib/ui";
import MIcon from "@/components/MaterialIcon";

export default function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: { label: string; icon?: string; onClick: () => void };
  secondaryAction?: { label: string; icon?: string; onClick: () => void };
  /** Mniejszy wariant do wąskich kontenerów (kolumny kanbana, panele). */
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? "28px 16px" : "56px 24px",
        color: tokens.muted,
      }}
    >
      <Illustration small={compact} />
      <div
        style={{
          marginTop: compact ? 12 : 18,
          fontSize: compact ? 13.5 : 15,
          fontWeight: 600,
          color: tokens.text,
        }}
      >
        {title}
      </div>
      {description && (
        <p style={{ margin: "5px 0 0", fontSize: compact ? 12.5 : 13, color: tokens.muted, maxWidth: 360 }}>
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div style={{ display: "flex", gap: 8, marginTop: compact ? 12 : 18 }}>
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} style={ghostButton}>
              {secondaryAction.icon && <MIcon name={secondaryAction.icon} size={16} />}
              {secondaryAction.label}
            </button>
          )}
          {action && (
            <button onClick={action.onClick} style={primaryButton}>
              {action.icon && <MIcon name={action.icon} size={16} />}
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Neutralna „ilustracja": szkic karty rekordu jak w pustych stanach Attio.
function Illustration({ small }: { small?: boolean }) {
  const w = small ? 72 : 104;
  const h = small ? 52 : 76;
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: 10,
        border: `1.5px solid ${tokens.border}`,
        background: "#FCFCFD",
        boxShadow: "0 1px 2px rgba(15,18,28,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: small ? 5 : 7,
        padding: small ? "0 12px" : "0 18px",
      }}
    >
      <span style={{ width: small ? 12 : 16, height: small ? 12 : 16, borderRadius: 5, background: tokens.borderSoft }} />
      <span style={{ width: "72%", height: small ? 4 : 5, borderRadius: 999, background: tokens.borderSoft }} />
      <span style={{ width: "48%", height: small ? 4 : 5, borderRadius: 999, background: tokens.borderSoft }} />
    </div>
  );
}
