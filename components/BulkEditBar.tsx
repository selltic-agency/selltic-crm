// components/BulkEditBar.tsx — akcja zbiorcza „ustaw właściwość" dla zaznaczonych
// rekordów. Wspólna dla Leadów i Prospectingu: wybierz właściwość, ustaw wartość
// (wg typu), zastosuj. Dla multi_select pozwala wybrać: dołóż / zastąp.
"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import type { PropertyView } from "@/lib/properties";
import { PropertyValueInput } from "@/components/PropertyFields";

export default function BulkEditBar({
  properties,
  count,
  onApply,
}: {
  properties: PropertyView[];
  count: number;
  onApply: (view: PropertyView, value: unknown, mode: "replace" | "add") => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string>("");
  const [value, setValue] = useState<unknown>(null);
  const [mode, setMode] = useState<"replace" | "add">("add");
  const [busy, setBusy] = useState(false);

  const view = useMemo(() => properties.find((p) => p.key === key) ?? null, [properties, key]);
  const disabled = count === 0;

  function pick(k: string) {
    setKey(k);
    setValue(null);
    setMode("add");
  }

  async function apply() {
    if (!view || busy) return;
    setBusy(true);
    await onApply(view, value, mode);
    setBusy(false);
    setOpen(false);
    setKey("");
    setValue(null);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 12px",
          borderRadius: 10,
          border: `1px solid ${tokens.border}`,
          background: tokens.card,
          color: disabled ? tokens.muted : tokens.text,
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <SlidersHorizontal size={15} />
        Ustaw właściwość{count ? ` (${count})` : ""}
      </button>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            zIndex: 40,
            width: 320,
            maxWidth: "calc(100vw - 32px)",
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Ustaw dla {count} zaznaczonych</span>
            <button onClick={() => setOpen(false)} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center" }}>
              <X size={16} />
            </button>
          </div>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>Właściwość</span>
            <select value={key} onChange={(e) => pick(e.target.value)} style={inputStyle}>
              <option value="">— wybierz —</option>
              {properties.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {view && (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>Wartość</span>
                <PropertyValueInput view={view} value={value} onChange={setValue} />
              </label>

              {view.type === "multi_select" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {(["add", "replace"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${mode === m ? tokens.accent : tokens.border}`,
                        background: mode === m ? tokens.accentSoft : "#fff",
                        color: mode === m ? tokens.accent : tokens.text,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {m === "add" ? "Dołóż do istniejących" : "Zastąp"}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
                <button onClick={() => setOpen(false)} style={ghostButton}>
                  Anuluj
                </button>
                <button onClick={apply} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Zapisywanie…" : "Zastosuj"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
