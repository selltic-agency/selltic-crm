// components/PropertyFields.tsx — spójne renderowanie WARTOŚCI właściwości
// (custom fields) wg typu: wejście edycyjne (PropertyValueInput) i wyświetlanie
// (PropertyValueDisplay). Używane w panelu szczegółów leada/prospektu, w
// tabelach i w akcjach zbiorczych — jeden komponent = spójny wygląd wszędzie.
"use client";

import { tokens, inputStyle } from "@/lib/ui";
import { asArray, type PropertyView } from "@/lib/properties";
import type { PropertyOption } from "@/lib/types";
import { BOOL_NO, BOOL_YES } from "@/lib/properties";

function pill(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    lineHeight: 1.3,
    color,
    background: `${color}1A`,
    border: `1px solid ${color}33`,
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

const EMPTY = <span style={{ color: tokens.muted }}>—</span>;

function optLabel(options: PropertyOption[], key: string): { label: string; color: string } {
  const o = options.find((x) => x.key === key);
  return { label: o?.label ?? key, color: o?.color ?? tokens.accent };
}

// ── Wyświetlanie wartości (tabela / karta) — zawsze bezpieczne dla braku. ──
export function PropertyValueDisplay({ view, value }: { view: PropertyView; value: unknown }) {
  if (view.type === "boolean") {
    if (value === undefined || value === null || value === "") return EMPTY;
    const yes = value === true || value === BOOL_YES || value === "true";
    return <span style={pill(yes ? tokens.success : tokens.muted)}>{yes ? "Tak" : "Nie"}</span>;
  }

  if (view.type === "multi_select") {
    const keys = asArray(value);
    if (keys.length === 0) return EMPTY;
    return (
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5 }}>
        {keys.map((k) => {
          const { label, color } = optLabel(view.options, k);
          return (
            <span key={k} style={pill(color)} title={label}>
              {label}
            </span>
          );
        })}
      </span>
    );
  }

  if (view.type === "select") {
    if (value === undefined || value === null || value === "") return EMPTY;
    const { label, color } = optLabel(view.options, String(value));
    return (
      <span style={pill(color)} title={label}>
        {label}
      </span>
    );
  }

  if (value === undefined || value === null || value === "") return EMPTY;

  if (view.type === "date") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return <>{String(value)}</>;
    return <>{d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}</>;
  }

  if (view.type === "email") {
    return (
      <a href={`mailto:${String(value)}`} style={{ color: tokens.accent }} onClick={(e) => e.stopPropagation()}>
        {String(value)}
      </a>
    );
  }

  return <>{String(value)}</>;
}

// ── Wejście edycyjne (panel szczegółów / akcja zbiorcza) ──────────────────
export function PropertyValueInput({
  view,
  value,
  onChange,
  autoFocus,
}: {
  view: PropertyView;
  value: unknown;
  onChange: (value: unknown) => void;
  autoFocus?: boolean;
}) {
  if (view.type === "boolean") {
    const cur = value === true || value === BOOL_YES || value === "true" ? BOOL_YES : value === false || value === BOOL_NO || value === "false" ? BOOL_NO : "";
    return (
      <select value={cur} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === BOOL_YES)} style={inputStyle} autoFocus={autoFocus}>
        <option value="">—</option>
        <option value={BOOL_YES}>Tak</option>
        <option value={BOOL_NO}>Nie</option>
      </select>
    );
  }

  if (view.type === "select") {
    return (
      <select value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)} style={inputStyle} autoFocus={autoFocus}>
        <option value="">—</option>
        {view.options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (view.type === "multi_select") {
    const selected = asArray(value);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 0" }}>
        {view.options.length === 0 && <span style={{ fontSize: 12.5, color: tokens.muted }}>Brak opcji.</span>}
        {view.options.map((o) => {
          const isSel = selected.includes(o.key);
          return (
            <label
              key={o.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${isSel ? tokens.accent : tokens.border}`,
                background: isSel ? tokens.accentSoft : "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: isSel ? tokens.accent : tokens.text,
              }}
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, o.key]);
                  else onChange(selected.filter((k) => k !== o.key));
                }}
                style={{ display: "none" }}
              />
              {o.label}
            </label>
          );
        })}
      </div>
    );
  }

  const inputType = view.type === "number" ? "number" : view.type === "date" ? "date" : view.type === "email" ? "email" : "text";
  return (
    <input
      type={inputType}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      style={inputStyle}
      autoFocus={autoFocus}
    />
  );
}
