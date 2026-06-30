// app/global-error.tsx — ostatnia linia obrony (błędy w root layoutcie).
// Musi renderować własne <html>/<body>, bo zastępuje cały dokument.
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="pl">
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, system-ui, sans-serif",
          background: "#F6F7F9",
          color: "#1A1D26",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #ECEEF3",
            borderRadius: 16,
            padding: "40px 28px",
            textAlign: "center",
            maxWidth: 420,
          }}
        >
          <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
            Wystąpił błąd
          </p>
          <p style={{ fontSize: 14, color: "#8A92A6", margin: "0 0 20px" }}>
            Przepraszamy — coś poszło nie tak. Spróbuj ponownie.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 18px",
              background: "#6C5CE7",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Spróbuj ponownie
          </button>
        </div>
      </body>
    </html>
  );
}
