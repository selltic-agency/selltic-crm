// app/admin/shell.tsx — chrome panelu: sidebar (230px) + topbar.
// Client component, bo aktywny element nawigacji zależy od bieżącej ścieżki.
// Responsywny: na telefonie sidebar zwija się do wysuwanego panelu (hamburger).
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  CheckSquare,
  BarChart3,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import NotificationBell from "@/components/NotificationBell";
import GlobalSearch from "@/components/GlobalSearch";
import ContactDrawer from "@/components/ContactDrawer";

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
  const isMobile = useIsMobile(900);
  const [navOpen, setNavOpen] = useState(false);
  const [drawerContact, setDrawerContact] = useState<string | null>(null);

  // Zamknij wysuwany panel po zmianie trasy / przejściu na desktop.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

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

  // ── Sidebar (treść współdzielona przez desktop i mobilny panel) ──────────
  const sidebar = (
    <aside
      style={{
        width: 250,
        flexShrink: 0,
        background: tokens.card,
        borderRight: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
        boxSizing: "border-box",
        ...(isMobile
          ? {
              position: "fixed",
              top: 0,
              left: 0,
              height: "100vh",
              zIndex: 60,
              transform: navOpen ? "translateX(0)" : "translateX(-100%)",
              transition: `transform .28s ${tokens.ease}`,
              boxShadow: navOpen ? "12px 0 40px rgba(15,18,28,0.18)" : "none",
            }
          : {
              width: 230,
              position: "sticky",
              top: 0,
              height: "100vh",
            }),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 18px",
        }}
      >
        <Link
          href="/admin"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
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
        {isMobile && (
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Zamknij menu"
            style={iconBtn}
          >
            <X size={18} color={tokens.muted} />
          </button>
        )}
      </div>

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
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: tokens.bg }}>
      {/* ── Sidebar ─────────────────────────────────────────── */}
      {sidebar}

      {/* Scrim pod wysuwanym panelem (tylko mobile) */}
      {isMobile && navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,18,28,0.40)",
            zIndex: 55,
          }}
        />
      )}

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
            gap: isMobile ? 10 : 16,
            padding: isMobile ? "0 14px" : "0 24px",
            position: "sticky",
            top: 0,
            zIndex: 5,
          }}
        >
          {isMobile ? (
            <>
              <button
                onClick={() => setNavOpen(true)}
                aria-label="Otwórz menu"
                style={iconBtn}
              >
                <Menu size={20} color={tokens.text} />
              </button>
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
              <GlobalSearch onOpenContact={setDrawerContact} fullWidth />
            </>
          ) : (
            <>
              <GlobalSearch onOpenContact={setDrawerContact} />
              <div style={{ flex: 1 }} />
            </>
          )}

          <NotificationBell onOpenContact={setDrawerContact} />

          <button
            onClick={logout}
            aria-label="Wyloguj"
            title={`Wyloguj (${email})`}
            style={iconBtn}
          >
            <LogOut size={18} color={tokens.muted} />
          </button>

          <div
            title={email}
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              flexShrink: 0,
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

        <main className="selltic-main" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>
      </div>

      {drawerContact && (
        <ContactDrawer contactId={drawerContact} onClose={() => setDrawerContact(null)} />
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  flexShrink: 0,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
