// components/ui.tsx — kanoniczne prymitywy UI panelu admina.
//
// Źródłem prawdy dla całego panelu jest ekran szczegółów leada
// (app/admin/leads/[id]/page.tsx): płaskie sekcje rozdzielone etykietą i
// światłem, proste pola, cienkie linie zamiast „pudełek”, oś czasu jako
// płaska lista z kolorowym paskiem statusu po lewej. Te komponenty wyciągają
// dokładnie te wzorce, żeby KAŻDY ekran używał tych samych klocków — bez
// odchyłek (mniej zaokrągleń, żadnych ciężkich kart tam, gdzie referencja
// używa tylko nagłówka sekcji + światła).
//
// UWAGA: dotyczy wyłącznie panelu admina; publiczny renderer formularzy
// (components/FormRenderer.tsx, app/f/*) ma własne style.
import type { CSSProperties, ReactNode } from "react";
import MIcon from "@/components/MaterialIcon";
import { tokens } from "@/lib/ui";

// ── Nagłówek sekcji ("DANE KONTAKTOWE" / "WŁAŚCIWOŚCI") ────────────────────
// Standardowy sposób dzielenia strony na grupy — zamiast opakowywać treść w
// obrysowaną kartę, poprzedzamy ją drobną, wersalikową, wyciszoną etykietą.
export function SectionTitle({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <h3
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: "0 0 12px",
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

// ── Etykieta pola formularza ──────────────────────────────────────────────
// Prosta etykieta nad płaskim polem (jak „Nazwa / osoba”, „Firma”, „Telefon”
// na ekranie leada). Bez ramek, bez tła — sama etykieta i kontrolka.
export function FieldLabel({
  label,
  hint,
  children,
  style,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0, ...style }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>{label}</span>
      {children}
      {hint != null && (
        <span style={{ fontSize: 11.5, color: tokens.muted, lineHeight: 1.4 }}>{hint}</span>
      )}
    </label>
  );
}

// ── Link „Wstecz” (strzałka + tekst) ──────────────────────────────────────
export function BackLink({
  onClick,
  label = "Wstecz",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "none",
        cursor: "pointer",
        color: tokens.muted,
        fontSize: 13,
        fontWeight: 600,
        padding: 0,
      }}
    >
      <MIcon name="arrow_back" size={16} />
      {label}
    </button>
  );
}

// ── Nagłówek strony ───────────────────────────────────────────────────────
// Powtarzalny wzorzec: (opcjonalny link wstecz) → tytuł → kontrolki po prawej.
// Tytuł dostaje min-width:0, żeby długie nazwy nie rozpychały wiersza akcji.
export function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
  style,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {onBack && (
        <div style={{ marginBottom: 8 }}>
          <BackLink onClick={onBack} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: 0,
              color: tokens.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h1>
          {subtitle != null && (
            <p style={{ fontSize: 13, color: tokens.muted, margin: "4px 0 0" }}>{subtitle}</p>
          )}
        </div>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Płaska sekcja: etykieta + treść, bez „pudełka” ────────────────────────
// Odpowiednik grup na ekranie leada. Domyślnie tylko światło pod etykietą;
// `divider` dokłada cienką linię nad sekcją (jak „Dane z Google Maps”).
export function Section({
  title,
  action,
  divider = false,
  children,
  style,
}: {
  title?: ReactNode;
  action?: ReactNode;
  divider?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        marginBottom: 22,
        ...(divider ? { marginTop: 22, paddingTop: 18, borderTop: `1px solid ${tokens.border}` } : {}),
        ...style,
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {title ? <SectionTitle style={{ margin: 0 }}>{title}</SectionTitle> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Wiersz osi czasu / listy (płaski, z kolorowym paskiem po lewej) ────────
// Kanoniczny wzorzec dla każdej listy typu oś czasu / historia / log
// (historia scrapowania, historia kontaktu w trybie dzwonienia itd.).
export function TimelineRow({
  stripe,
  onClick,
  children,
  style,
}: {
  stripe?: string;
  onClick?: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${stripe ?? tokens.border}`,
        borderRadius: 10,
        padding: "11px 13px",
        minWidth: 0,
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Kafelek ikony w wierszu osi czasu (miękkie tło z koloru statusu).
export function TimelineIcon({ icon, color, size = 15 }: { icon: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        flexShrink: 0,
        background: hexSoft(color),
        color,
        display: "grid",
        placeItems: "center",
      }}
    >
      <MIcon name={icon} size={size} />
    </div>
  );
}

// Grupa osi czasu — nagłówek (np. „Zaległe”, miesiąc) + odstępy między wpisami.
export function TimelineGroup({
  label,
  danger = false,
  children,
}: {
  label: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: danger ? "uppercase" : "none",
          color: danger ? tokens.danger : tokens.muted,
          margin: "0 0 12px",
        }}
      >
        {label}
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

// Miękkie (przezroczyste) tło z koloru hex — dla kafli ikon i chipów.
export function hexSoft(hex: string, alpha = 0.12): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return `rgba(108,92,231,${alpha})`;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
