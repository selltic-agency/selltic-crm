// app/layout.tsx — główny layout aplikacji (wymagany przez App Router).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { tokens } from "@/lib/theme";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

export const metadata: Metadata = {
  title: "Selltic — panel",
  description: "Forms + CRM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={inter.className}>
      <body
        style={{
          margin: 0,
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
