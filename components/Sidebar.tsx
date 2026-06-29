// components/Sidebar.tsx — boczna nawigacja panelu z podświetleniem aktywnej trasy.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  CheckSquare,
  BarChart3,
  FileText,
  Settings,
} from "lucide-react";
import { tokens } from "@/lib/design";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/admin/tasks", label: "Zadania", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analityka", icon: BarChart3 },
  { href: "/admin/forms", label: "Formularze", icon: FileText },
];

const SETTINGS = { href: "/admin/settings", label: "Ustawienia", icon: Settings };

export default function Sidebar() {
  const pathname = usePathname();

  // Dashboard jest aktywny tylko przy dokładnym /admin; reszta po prefiksie trasy.
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const item = (nav: typeof SETTINGS) => {
    const active = isActive(nav.href);
    const Icon = nav.icon;
    return (
      <Link
        key={nav.href}
        href={nav.href}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "10px 12px",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          color: active ? tokens.accent : tokens.muted,
          background: active ? tokens.accentSoft : "transparent",
          transition: "background 0.14s ease, color 0.14s ease",
        }}
      >
        <Icon size={18} strokeWidth={2} />
        {nav.label}
      </Link>
    );
  };

  return (
    <aside
      style={{
        width: 230,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        background: tokens.card,
        borderRight: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 8px 20px",
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: tokens.accent,
            color: "#fff",
            fontWeight: 800,
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          S
        </div>
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>
          Selltic
        </span>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV.map(item)}
      </nav>

      <div style={{ marginTop: "auto" }}>{item(SETTINGS)}</div>
    </aside>
  );
}
