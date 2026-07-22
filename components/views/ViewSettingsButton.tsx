// components/views/ViewSettingsButton.tsx — panel „Ustawienia widoku"
// (Attio-style): widoczność i kolejność kolumn tabeli, a dla kanbana —
// widoczne etapy lejka i pola pokazywane na kartach. Konfiguracja żyje w
// bieżącym widoku (saved_views.config), nie globalnie.
"use client";

import { useEffect, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { tokens, ghostButton, menuPanel } from "@/lib/ui";
import type { ColumnPref, ViewConfig, ViewMode } from "@/lib/savedViews";
import type { StageLike } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";

// Pola kart kanbana (Leady) — stały słownik.
export const KANBAN_CARD_FIELDS: { key: string; label: string }[] = [
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-mail" },
  { key: "activity", label: "Ostatnia / następna aktywność" },
  { key: "footer", label: "Owner i wartość" },
];

export default function ViewSettingsButton({
  viewMode,
  columns,
  columnLabels,
  onColumnsChange,
  stages,
  kanban,
  onKanbanChange,
}: {
  viewMode: ViewMode;
  /** Pełna lista kolumn (widoczne + ukryte) w kolejności widoku. */
  columns: ColumnPref[];
  columnLabels: Record<string, string>;
  onColumnsChange: (columns: ColumnPref[]) => void;
  /** Etapy lejka (tylko Leady/kanban). */
  stages?: StageLike[];
  kanban?: NonNullable<ViewConfig["kanban"]>;
  onKanbanChange?: (kanban: NonNullable<ViewConfig["kanban"]>) => void;
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

  const hiddenStages = kanban?.hiddenStages ?? [];
  const cardFields = kanban?.cardFields ?? KANBAN_CARD_FIELDS.map((f) => f.key);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...ghostButton, color: tokens.muted }}>
        <MIcon name="tune" size={16} />
        Ustawienia widoku
        <MIcon name="expand_more" size={15} />
      </button>

      {open && (
        <div
          style={{
            ...menuPanel,
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            zIndex: 45,
            width: 300,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "min(480px, calc(100vh - 120px))",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ overflowY: "auto", padding: 10 }} className="selltic-scroll-y">
            {viewMode === "kanban" && stages && onKanbanChange ? (
              <>
                <SectionLabel>Widoczne etapy</SectionLabel>
                <div style={{ display: "grid", gap: 2, marginBottom: 12 }}>
                  {stages.map((s) => {
                    const visible = !hiddenStages.includes(s.key);
                    return (
                      <CheckRow
                        key={s.key}
                        label={s.label}
                        color={s.color}
                        checked={visible}
                        onToggle={() =>
                          onKanbanChange({
                            ...kanban,
                            hiddenStages: visible ? [...hiddenStages, s.key] : hiddenStages.filter((k) => k !== s.key),
                          })
                        }
                      />
                    );
                  })}
                </div>

                <SectionLabel>Pola na kartach</SectionLabel>
                <div style={{ display: "grid", gap: 2 }}>
                  {KANBAN_CARD_FIELDS.map((f) => {
                    const on = cardFields.includes(f.key);
                    return (
                      <CheckRow
                        key={f.key}
                        label={f.label}
                        checked={on}
                        onToggle={() =>
                          onKanbanChange({
                            ...kanban,
                            cardFields: on ? cardFields.filter((k) => k !== f.key) : [...cardFields, f.key],
                          })
                        }
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <SectionLabel>Kolumny i kolejność</SectionLabel>
                <Reorder.Group
                  axis="y"
                  values={columns}
                  onReorder={(next: ColumnPref[]) => onColumnsChange(next.map((c, i) => ({ ...c, position: i })))}
                  style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 1 }}
                >
                  {columns.map((col) => (
                    <Reorder.Item
                      key={col.key}
                      value={col}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 4px", borderRadius: 6, background: tokens.card, fontSize: 13 }}
                    >
                      <MIcon name="drag_indicator" size={15} color={tokens.muted} style={{ cursor: "grab" }} />
                      <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={col.visible}
                          onChange={() =>
                            onColumnsChange(columns.map((c) => (c.key === col.key ? { ...c, visible: !c.visible } : c)))
                          }
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{ cursor: "pointer", flexShrink: 0, accentColor: tokens.accent }}
                        />
                        <span style={{ fontWeight: 500, color: col.visible ? tokens.text : tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {columnLabels[col.key] ?? col.key}
                        </span>
                      </label>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, padding: "2px 4px 6px" }}>
      {children}
    </div>
  );
}

function CheckRow({
  label,
  color,
  checked,
  onToggle,
}: {
  label: string;
  color?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ cursor: "pointer", accentColor: tokens.accent, flexShrink: 0 }} />
      {color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />}
      <span style={{ fontWeight: 500, color: checked ? tokens.text : tokens.muted }}>{label}</span>
    </label>
  );
}
