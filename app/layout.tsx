// app/layout.tsx — główny layout aplikacji (wymagany przez App Router).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

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
          background: "#f6f7f9",
          color: "#1a1d26",
        }}
      >
        {children}
      </body>
    </html>
  );
}
