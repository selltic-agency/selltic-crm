// app/admin/shell.tsx — chrome panelu (redesign Attio-style): sam sidebar,
// bez topbara na desktopie. Sidebar: nagłówek (logo + nazwa firmy z dropdownem
// Ustawienia/Wyloguj się + dzwonek powiadomień), kompaktowa wyszukiwarka,
// nawigacja główna i sekcja „Sprzedaż". Na telefonie sidebar zwija się do
// wysuwanego panelu (hamburger w wąskim topbarze).
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
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
  { href: "/admin/submissions", label: "Zgłoszenia", icon: "move_to_inbox" },
  { href: "/admin/forms", label: "Formularze", icon: "description" },
  { href: "/admin/scraper", label: "Scraper", icon: "travel_explore" },
];

const SALES_NAV = [
  { href: "/admin/pipeline", label: "Leady", icon: "view_kanban" },
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
  const [collapsed, setCollapsed] = useState(false);
  const [companyName, setCompanyName] = useState("Selltic");

  // Zwinięcie sidebara (do wąskiej szyny z ikonami) — trwałe per przeglądarka.
  useEffect(() => {
    if (localStorage.getItem("selltic_sidebar_collapsed") === "1") setCollapsed(true);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("selltic_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };

  // Na desktopie sidebar może być zwinięty; na mobile zawsze pełny (panel).
  const railed = collapsed && !isMobile;
  const width = railed ? 64 : SIDEBAR_W;

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
        width: isMobile ? SIDEBAR_W : width,
        flexShrink: 0,
        background: tokens.card,
        borderRight: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        padding: railed ? "10px 8px 12px" : "10px 10px 12px",
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
              transition: `width .2s ${tokens.ease}, padding .2s ${tokens.ease}`,
            }),
      }}
    >
      {/* Nagłówek: logo + nazwa firmy (dropdown) + dzwonek */}
      <div style={{ display: "flex", flexDirection: railed ? "column" : "row", alignItems: "center", gap: railed ? 6 : 4, padding: railed ? "2px 0 8px" : "2px 2px 8px", justifyContent: railed ? "center" : undefined }}>
        {railed ? (
          <>
            <Logo />
            <button
              onClick={toggleCollapsed}
              aria-label="Rozwiń menu"
              title="Rozwiń menu"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: tokens.muted, padding: 4, display: "grid", placeItems: "center" }}
            >
              <MIcon name="left_panel_open" size={18} />
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Logo />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: tokens.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {companyName}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <NotificationBell onOpenContact={openContact} />
            {!isMobile && (
              <button
                onClick={toggleCollapsed}
                aria-label="Zwiń menu"
                title="Zwiń menu"
                style={{ border: "none", background: "transparent", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", padding: 4 }}
              >
                <MIcon name="left_panel_close" size={18} />
              </button>
            )}
            {isMobile && (
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Zamknij menu"
                style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", padding: 4 }}
              >
                <MIcon name="close" size={18} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Kompaktowa wyszukiwarka (ukryta w wąskiej szynie) */}
      {railed ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "0 0 8px" }}>
          <NotificationBell onOpenContact={openContact} />
        </div>
      ) : (
        <div style={{ padding: "0 2px 10px" }}>
          <GlobalSearch onOpenContact={openContact} onOpenProspect={openProspect} variant="sidebar" />
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {MAIN_NAV.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href, item.exact)} railed={railed} />
        ))}

        {railed ? (
          <div style={{ height: 1, background: tokens.borderSoft, margin: "10px 6px" }} />
        ) : (
          <div style={{ padding: "14px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>
            Sprzedaż
          </div>
        )}
        {SALES_NAV.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href)} railed={railed} />
        ))}
      </nav>

      {/* Blok dolny: Ustawienia + Wyloguj się — przypięte do dołu sidebara
          (dawniej w rozwijanym menu firmy). Działa w trybie pełnym, zwiniętym
          i w panelu mobilnym. */}
      <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, paddingTop: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 1 }}>
        {!railed && (
          <div title={email} style={{ padding: "2px 10px 6px", fontSize: 11.5, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email}
          </div>
        )}
        <NavItem href="/admin/settings" label="Ustawienia" icon="settings" active={isActive("/admin/settings")} railed={railed} />
        <LogoutItem onLogout={logout} railed={railed} />
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
          marginLeft: isMobile ? 0 : width,
          transition: isMobile ? undefined : `margin-left .2s ${tokens.ease}`,
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

// Przycisk „Wyloguj się" w dolnym bloku sidebara — styl spójny z NavItem
// (pełny i zwinięty).
function LogoutItem({ onLogout, railed }: { onLogout: () => void; railed: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onLogout}
      title={railed ? "Wyloguj się" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: railed ? "center" : "flex-start",
        gap: railed ? 0 : 9,
        padding: railed ? "8px 0" : "6px 10px",
        borderRadius: tokens.radiusSm,
        border: "none",
        width: "100%",
        textAlign: "left",
        fontSize: 13,
        fontWeight: 500,
        color: tokens.muted,
        background: hover ? "#FAFAFB" : "transparent",
        cursor: "pointer",
        transition: `background .15s ${tokens.ease}`,
      }}
    >
      <MIcon name="logout" size={18} color={tokens.muted} style={{ flexShrink: 0 }} />
      {!railed && <span>Wyloguj się</span>}
    </button>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  railed = false,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  railed?: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={href}
      title={railed ? label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: railed ? "center" : "flex-start",
        gap: railed ? 0 : 9,
        padding: railed ? "8px 0" : "6px 10px",
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
      <MIcon name={icon} size={18} fill={active} color={active ? tokens.accent : tokens.muted} style={{ flexShrink: 0 }} />
      {!railed && (
        <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      )}
    </Link>
  );
}
