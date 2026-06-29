// app/admin/topbar.tsx — górny pasek panelu (wyszukiwarka UI + dzwonek + awatar).
"use client";

import { Search, Bell } from "lucide-react";
import { tokens } from "@/lib/theme";

export default function Topbar() {
  return (
    <header
      style={{
        height: 64,
        flex: "0 0 64px",
        background: tokens.card,
        borderBottom: `1px solid ${tokens.border}`,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Wyszukiwarka — tylko UI w tej fazie */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          maxWidth: 420,
          padding: "8px 12px",
          borderRadius: 10,
          background: tokens.bg,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <Search size={16} color={tokens.muted} />
        <input
          placeholder="Szukaj…"
          aria-label="Szukaj"
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 14,
            width: "100%",
            color: tokens.text,
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Dzwonek z miejscem na odznakę nieprzeczytanych */}
      <button
        aria-label="Powiadomienia"
        style={{
          position: "relative",
          width: 38,
          height: 38,
          borderRadius: 10,
          border: `1px solid ${tokens.border}`,
          background: tokens.card,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        <Bell size={18} color={tokens.text} />
      </button>

      {/* Awatar admina */}
      <div
        title="Dominik"
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: tokens.accent,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        D
      </div>
    </header>
  );
}
