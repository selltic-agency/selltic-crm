// app/layout.tsx — główny layout aplikacji (wymagany przez App Router).
// Font Inter ładujemy przez <link> do Google Fonts (w czasie działania, nie buildu),
// żeby build na Vercelu nie zależał od sieci podczas kompilacji.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { tokens } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Selltic — panel",
  description: "Forms + CRM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: tokens.bg,
          color: tokens.text,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
