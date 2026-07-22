// components/views/SortButton.tsx — kompaktowa kontrolka sortowania
// („Sortowanie: Data utworzenia ▾"), Attio-style. Lista pól + kierunek.
"use client";

import { useEffect, useRef, useState } from "react";
import { tokens, ghostButton, menuPanel } from "@/lib/ui";
import type { Sort } from "@/lib/filters";
import MIcon from "@/components/MaterialIcon";

export default function SortButton({
  fields,
  sort,
  defaultLabel,
  onChange,
}: {
  /** Pola sortowalne: klucz kolumny + etykieta. */
  fields: { key: string; label: string }[];
  sort: Sort | null;
  /** Etykieta stanu domyślnego (gdy sort === null), np. "Score". */
  defaultLabel?: string;
  onChange: (sort: Sort | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = sort ? fields.find((f) => f.key === sort.column) : null;
  const label = current?.label ?? defaultLabel ?? "domyślne";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...ghostButton, color: tokens.muted }}>
        <MIcon name="swap_vert" size={16} />
        <span style={{ color: tokens.muted }}>Sortowanie:</span>
        <span style={{ color: tokens.text, fontWeight: 600 }}>{label}</span>
        {sort && <MIcon name={sort.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={13} color={tokens.text} />}
        <MIcon name="expand_more" size={15} />
      </button>

      {open && (
        <div style={{ ...menuPanel, position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 45, minWidth: 220 }}>
          <div style={{ maxHeight: 280, overflowY: "auto", padding: 4 }}>
            {fields.map((f) => {
              const active = sort?.column === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => {
                    // Klik w aktywne pole odwraca kierunek; w nowe — desc.
                    onChange(active ? { column: f.key, direction: sort!.direction === "desc" ? "asc" : "desc" } : { column: f.key, direction: "desc" });
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 9px",
                    border: "none",
                    borderRadius: 6,
                    background: active ? tokens.accentSoft : "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    color: active ? tokens.accent : tokens.text,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = tokens.bg;
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "none";
                  }}
                >
                  {f.label}
                  {active && <MIcon name={sort!.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={14} />}
                </button>
              );
            })}
          </div>
          {sort && (
            <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, padding: 4 }}>
              <button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", border: "none", background: "none", cursor: "pointer", fontSize: 12.5, color: tokens.muted, borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                Przywróć domyślne
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
