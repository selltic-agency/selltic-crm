// app/admin/shell.tsx — chrome panelu (redesign Attio-style): sam sidebar,
// bez topbara na desktopie. Sidebar: nagłówek (logo + nazwa firmy z dropdownem
// Ustawienia/Wyloguj się + dzwonek powiadomień), kompaktowa wyszukiwarka,
// nawigacja główna i sekcja „Sprzedaż". Na telefonie sidebar zwija się do
// wysuwanego panelu (hamburger w wąskim topbarze).
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, menuPanel } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import MIcon from "@/components/MaterialIcon";
import NotificationBell from "@/components/NotificationBell";
import GlobalSearch from "@/components/GlobalSearch";

const SIDEBAR_W = 240;

const MAIN_NAV = [
  { href: "/admin", label: "Start", icon: "home", exact: true },
  { href: "/admin/tasks", label: "Zadania", icon: "task_alt" },
  { href: "/admin/calendar", label: "Kalendarz", icon: "calendar_month" },
  { href: "/admin/analytics", label: "Raporty", icon: "monitoring" },
  { href: "/admin/forms", label: "Formularze", icon: "description" },
];

const SALES_NAV = [
  { href: "/admin/pipeline", label: "Leady", icon: "view_kanban" },
  { href: "/admin/scraper", label: "Scraper", icon: "travel_explore" },
  { href: "/admin/prospecting", label: "Prospecting", icon: "call" },
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
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile(900);
  const [navOpen, setNavOpen] = useState(false);
  const [companyName, setCompanyName] = useState("Selltic");

  // Nazwa firmy z Ustawień (app_settings.company_name; przed migracją kolumny
  // zapytanie zwraca błąd → zostaje domyślna nazwa).
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("app_settings").select("company_name").maybeSingle();
      const name = (data as { company_name?: string | null } | null)?.company_name;
      if (!error && name && name.trim()) setCompanyName(name.trim());
    })();
  }, [supabase]);

  // Klik w deal (wyszukiwarka, dzwonek) prowadzi na stronę deala; klik w
  // prospekt otwiera szufladę na liście prospektów (?prospect=).
  const openContact = (id: string) => router.push(`/admin/leads/${id}`);
  const openProspect = (id: string) => router.push(`/admin/prospecting?prospect=${id}`);

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
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // ── Sidebar (treść współdzielona przez desktop i mobilny panel) ──────────
  const sidebar = (
    <aside
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: tokens.card,
        borderRight: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        padding: "10px 10px 12px",
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
              position: "fixed",
              top: 0,
              left: 0,
              height: "100vh",
              zIndex: 20,
            }),
      }}
    >
      {/* Nagłówek: logo + nazwa firmy (dropdown) + dzwonek */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 2px 8px" }}>
        <CompanyMenu companyName={companyName} email={email} onLogout={logout} />
        <div style={{ flex: 1 }} />
        <NotificationBell onOpenContact={openContact} />
        {isMobile && (
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Zamknij menu"
            style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", padding: 4 }}
          >
            <MIcon name="close" size={18} />
          </button>
        )}
      </div>

      {/* Kompaktowa wyszukiwarka (zastępuje dawną dużą w topbarze) */}
      <div style={{ padding: "0 2px 10px" }}>
        <GlobalSearch onOpenContact={openContact} onOpenProspect={openProspect} variant="sidebar" />
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {MAIN_NAV.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href, item.exact)} />
        ))}

        <div style={{ padding: "14px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>
          Sprzedaż
        </div>
        {SALES_NAV.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      {/* Stopka: skrót do ustawień */}
      <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, paddingTop: 8 }}>
        <NavItem href="/admin/settings" label="Ustawienia" icon="settings" active={isActive("/admin/settings")} />
      </div>
    </aside>
  );

  return (
    <div className="selltic-admin" style={{ display: "flex", minHeight: "100vh", background: tokens.bg }}>
      {/* Font ikon Material Symbols (tylko panel admina — publiczne formularze
          go nie ładują). React hoistuje <link> do <head>. */}
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
      />

      {sidebar}

      {/* Scrim pod wysuwanym panelem (tylko mobile) */}
      {isMobile && navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 55 }}
        />
      )}

      {/* ── Główny obszar ───────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          marginLeft: isMobile ? 0 : SIDEBAR_W,
        }}
      >
        {/* Wąski topbar tylko na mobile (hamburger) */}
        {isMobile && (
          <header
            style={{
              height: 56,
              flexShrink: 0,
              background: tokens.card,
              borderBottom: `1px solid ${tokens.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 12px",
              position: "sticky",
              top: 0,
              zIndex: 5,
            }}
          >
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Otwórz menu"
              style={{ border: "none", background: "none", cursor: "pointer", color: tokens.text, display: "grid", placeItems: "center", padding: 6 }}
            >
              <MIcon name="menu" size={20} />
            </button>
            <Logo />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{companyName}</span>
          </header>
        )}

        <main className="selltic-main" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        background: tokens.accent,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      S
    </span>
  );
}

// Nagłówek sidebara: logo + nazwa firmy; klik otwiera dropdown z Ustawieniami
// i wylogowaniem (adres e-mail konta jako podpis).
function CompanyMenu({
  companyName,
  email,
  onLogout,
}: {
  companyName: string;
  email: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 7px",
          borderRadius: tokens.radiusSm,
          border: "1px solid transparent",
          background: open ? tokens.bg : "transparent",
          cursor: "pointer",
          minWidth: 0,
          maxWidth: 158,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = open ? tokens.bg : "transparent")}
      >
        <Logo />
        <span style={{ fontWeight: 600, fontSize: 13.5, color: tokens.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {companyName}
        </span>
        <MIcon name="expand_more" size={16} color={tokens.muted} />
      </button>

      {open && (
        <div style={{ ...menuPanel, position: "absolute", top: "100%", left: 0, marginTop: 4, width: 220, zIndex: 90 }}>
          <div style={{ padding: "9px 12px 7px", borderBottom: `1px solid ${tokens.borderSoft}` }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{companyName}</div>
            <div style={{ fontSize: 11.5, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>
          </div>
          <MenuItem
            icon="settings"
            label="Ustawienia"
            onClick={() => {
              setOpen(false);
              router.push("/admin/settings");
            }}
          />
          <MenuItem
            icon="logout"
            label="Wyloguj się"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        textAlign: "left",
        padding: "7px 12px",
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: 13,
        color: tokens.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <MIcon name={icon} size={16} color={tokens.muted} />
      {label}
    </button>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 10px",
        borderRadius: tokens.radiusSm,
        textDecoration: "none",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? tokens.text : tokens.muted,
        background: active ? tokens.bg : hover ? "#FAFAFB" : "transparent",
        transition: `background .15s ${tokens.ease}`,
        outline: "none",
      }}
    >
      <MIcon name={icon} size={18} fill={active} color={active ? tokens.accent : tokens.muted} />
      <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{label}</span>
    </Link>
  );
}
