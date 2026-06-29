// app/admin/shell.tsx — chrome panelu: sidebar (230px) + topbar.
// Client component, bo aktywny element nawigacji zależy od bieżącej ścieżki.
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  CheckSquare,
  BarChart3,
  FileText,
  Settings,
  Search,
  Bell,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";

const NAV = [
  { href: "/admin", label: "Pulpit", icon: LayoutDashboard, exact: true },
  { href: "/admin/pipeline", label: "Lejek", icon: KanbanSquare },
  { href: "/admin/tasks", label: "Zadania", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analityka", icon: BarChart3 },
  { href: "/admin/forms", label: "Formularze", icon: FileText },
];

export default function Shell({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const avatarLetter = (email?.[0] ?? "D").toUpperCase();

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: tokens.bg }}>
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        style={{
          width: 230,
          flexShrink: 0,
          background: tokens.card,
          borderRight: `1px solid ${tokens.border}`,
          display: "flex",
          flexDirection: "column",
          padding: "20px 14px",
          position: "sticky",
          top: 0,
          height: "100vh",
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/admin"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "4px 8px 18px",
            textDecoration: "none",
            color: tokens.text,
          }}
        >
          <span
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
          </span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Selltic</span>
        </Link>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "10px 12px",
                  borderRadius: 10,
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: 600,
                  color: active ? tokens.accent : tokens.muted,
                  background: active ? tokens.accentSoft : "transparent",
                  transition: `background .15s ${tokens.ease}`,
                }}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/admin/settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "10px 12px",
            borderRadius: 10,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            color: isActive("/admin/settings") ? tokens.accent : tokens.muted,
            background: isActive("/admin/settings")
              ? tokens.accentSoft
              : "transparent",
          }}
        >
          <Settings size={18} />
          Ustawienia
        </Link>
      </aside>

      {/* ── Główny obszar ───────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <header
          style={{
            height: 64,
            flexShrink: 0,
            background: tokens.card,
            borderBottom: `1px solid ${tokens.border}`,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 24px",
            position: "sticky",
            top: 0,
            zIndex: 5,
          }}
        >
          <div
            style={{
              flex: 1,
              maxWidth: 420,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: 10,
              padding: "8px 12px",
            }}
          >
            <Search size={16} color={tokens.muted} />
            <input
              placeholder="Szukaj…"
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

          <button
            aria-label="Powiadomienia"
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <Bell size={18} color={tokens.muted} />
          </button>

          <button
            onClick={logout}
            aria-label="Wyloguj"
            title={`Wyloguj (${email})`}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <LogOut size={18} color={tokens.muted} />
          </button>

          <div
            title={email}
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
            {avatarLetter}
          </div>
        </header>

        <main style={{ flex: 1, padding: "28px 24px", minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
