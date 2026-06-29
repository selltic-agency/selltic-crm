// components/PipelineBoard.tsx — tablica kanban lejka sprzedaży.
// 5 kolumn etapów; klik w kartę otwiera szufladę kontaktu.
"use client";

import { useMemo, useState } from "react";
import { STAGES, type Contact, type PropertyDef } from "@/lib/types";
import { formatPLN, sourceLabel, tokens } from "@/lib/design";
import ContactDrawer from "@/components/ContactDrawer";

export default function PipelineBoard({
  initialContacts,
  propertyDefs,
}: {
  initialContacts: Contact[];
  propertyDefs: PropertyDef[];
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [openId, setOpenId] = useState<string | null>(null);

  // Grupowanie kontaktów po etapie (zachowuje świeży stan przy zmianach).
  const byStage = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    for (const s of STAGES) map[s.id] = [];
    for (const c of contacts) (map[c.stage] ?? (map[c.stage] = [])).push(c);
    return map;
  }, [contacts]);

  const open = contacts.find((c) => c.id === openId) ?? null;

  function applyChange(updated: Contact) {
    setContacts((list) => list.map((c) => (c.id === updated.id ? updated : c)));
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>Pipeline</h1>
      <p style={{ margin: "0 0 22px", color: tokens.muted, fontSize: 14 }}>
        {contacts.length} {contacts.length === 1 ? "kontakt" : "kontaktów"} w lejku
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`,
          gap: 14,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {STAGES.map((stage) => {
          const items = byStage[stage.id] ?? [];
          const total = items.reduce((sum, c) => sum + (c.value || 0), 0);
          return (
            <div key={stage.id} style={{ minWidth: 220 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                  paddingBottom: 10,
                  borderBottom: `2px solid ${stage.color}`,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14 }}>{stage.label}</span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "1px 8px",
                    borderRadius: 999,
                    background: tokens.accentSoft,
                    color: tokens.accent,
                  }}
                >
                  {items.length}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: tokens.muted }}>
                  {formatPLN(total)}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: tokens.muted,
                      padding: "16px 0",
                      textAlign: "center",
                    }}
                  >
                    Brak kontaktów
                  </div>
                ) : (
                  items.map((c) => (
                    <button
                      key={c.id}
                      className="card-hover"
                      onClick={() => setOpenId(c.id)}
                      style={{
                        textAlign: "left",
                        cursor: "pointer",
                        background: tokens.card,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 14,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {c.name || "Bez nazwy"}
                      </span>
                      {c.company && (
                        <span style={{ fontSize: 12.5, color: tokens.muted }}>{c.company}</span>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          marginTop: 2,
                        }}
                      >
                        <span style={{ fontSize: 11.5, color: tokens.muted }}>
                          {sourceLabel(c.source)}
                        </span>
                        {c.value > 0 && (
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {formatPLN(c.value)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <ContactDrawer
          contact={open}
          propertyDefs={propertyDefs}
          onClose={() => setOpenId(null)}
          onContactChange={applyChange}
        />
      )}
    </div>
  );
}
