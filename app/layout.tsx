// app/layout.tsx — główny layout aplikacji (wymagany przez App Router).
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Selltic — panel",
  description: "Forms + CRM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f6f7f9",
          color: "#111827",
        }}
      >
        {children}
      </body>
    </html>
  );
}
