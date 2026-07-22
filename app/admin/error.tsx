// app/admin/error.tsx — granica błędu dla panelu.
// Łapie nieobsłużone wyjątki renderu/po stronie klienta i pokazuje
// przyjazny komunikat z możliwością ponowienia, zamiast białego ekranu.
"use client";

import { useEffect } from "react";
import { tokens, primaryButton } from "@/lib/ui";
import MIcon from "@/components/MaterialIcon";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin error boundary]", error);
  }, [error]);

  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "60vh",
        padding: 24,
      }}
    >
      <div
        style={{
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: "40px 28px",
          textAlign: "center",
          maxWidth: 440,
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "rgba(229,72,77,0.10)",
            color: tokens.danger,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
          }}
        >
          <MIcon name="warning" size={26} />
        </span>
        <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px", color: tokens.text }}>
          Coś poszło nie tak
        </p>
        <p style={{ fontSize: 14, color: tokens.muted, margin: "0 0 20px", lineHeight: 1.5 }}>
          Wystąpił nieoczekiwany błąd. Spróbuj ponownie — jeśli problem się
          powtarza, odśwież stronę.
        </p>
        <button
          onClick={reset}
          style={{ ...primaryButton, display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <MIcon name="history" size={16} />
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
}
