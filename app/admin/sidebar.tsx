// app/admin/sidebar.tsx — lewy pasek nawigacji panelu (230px).
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
import { tokens } from "@/lib/theme";
import LogoutButton from "./logout-button";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/admin/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/forms", label: "Forms", icon: FileText },
];

export default function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside
      style={{
        width: 230,
        flex: "0 0 230px",
        background: tokens.card,
        borderRight: `1px solid ${tokens.border}`,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
        boxSizing: "border-box",
      }}
    >
      {/* Logo + nazwa workspace */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 8px 18px",
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: tokens.accent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          S
        </div>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Selltic</span>
      </div>

      {/* Nawigacja */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link key={href} href={href} style={navItemStyle(active)}>
              <Icon size={18} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Settings + wyloguj na dole */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Link href="/admin/settings" style={navItemStyle(isActive("/admin/settings"))}>
          <Settings size={18} strokeWidth={2} />
          Settings
        </Link>
        <div style={{ padding: "8px 6px 0" }}>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    color: active ? tokens.accent : tokens.text,
    background: active ? tokens.accentSoft : "transparent",
  };
}
