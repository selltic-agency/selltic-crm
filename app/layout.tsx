// app/layout.tsx — główny layout aplikacji (wymagany przez App Router).
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

export const metadata: Metadata = {
  title: "Selltic — panel",
  description: "Forms + CRM",
};

// Poprawne skalowanie na telefonach (responsywność).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={inter.className}>
      <body
        style={{
          margin: 0,
          fontFamily: "inherit",
          background: "#F6F7F9",
          color: "#1A1D26",
        }}
      >
        {children}
      </body>
    </html>
  );
}
