// components/StageSelector.tsx — §8. Selektor etapu w stylu HubSpot.
// Trigger pokazuje bieżący etap (kolor + etykieta); menu listuje wszystkie etapy
// z pipeline_stages (kolor każdego). Zmiana wywołuje onChange (zapis natychmiastowy
// z optymistycznym UI po stronie wywołującego). Jeden komponent dla karty i strony.
"use client";

import { useEffect, useRef, useState } from "react";
import { tokens } from "@/lib/ui";
import type { PipelineStage } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";

export default function StageSelector({
  stages,
  value,
  onChange,
  disabled,
}: {
  stages: PipelineStage[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = stages.find((s) => s.key === value) ?? stages[0];

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const color = current?.color ?? tokens.accent;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "7px 12px", borderRadius: 999, cursor: disabled ? "default" : "pointer",
          border: "none", background: color, color: "#fff", fontSize: 13, fontWeight: 700,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.9)" }} />
        {current?.label ?? "—"}
        {!disabled && <MIcon name="expand_more" size={15} style={{ opacity: 0.85 }} />}
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: 40, left: 0, zIndex: 40, minWidth: 220,
            background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 12,
            boxShadow: "0 12px 34px rgba(15,18,28,0.16)", padding: 6,
          }}
        >
          {stages.map((s) => {
            const active = s.key === value;
            return (
              <button
                key={s.key}
                role="option"
                aria-selected={active}
                onClick={() => { setOpen(false); onChange(s.key); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                  padding: "9px 10px", borderRadius: 8, border: "none", background: active ? tokens.bg : "transparent",
                  cursor: "pointer", fontSize: 13.5, fontWeight: active ? 700 : 500, color: tokens.text,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? tokens.bg : "transparent")}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {active && <MIcon name="check" size={15} color={tokens.accent} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
