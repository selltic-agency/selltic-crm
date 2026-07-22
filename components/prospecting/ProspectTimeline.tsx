// components/prospecting/ProspectTimeline.tsx — kompozytor notatek + trwała
// oś czasu kontaktu prospektu (notatki i KAŻDA zmiana statusu przeplecione
// chronologicznie, HubSpot-style). Jedno źródło danych (props.history) dla
// trybu dzwonienia i szuflady szczegółów.
"use client";

import { useEffect, useState } from "react";
import { tokens, inputStyle, primaryButton, formatRelative, formatDateTime } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { timelineOf, eventLabel, eventIcon, eventColor } from "@/lib/prospectHistory";
import MIcon from "@/components/MaterialIcon";

export default function ProspectTimeline({
  prospect,
  onAddNote,
  autoFocusComposer = false,
}: {
  prospect: Prospect;
  onAddNote: (body: string) => Promise<void>;
  autoFocusComposer?: boolean;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Czysty kompozytor przy przejściu na inny rekord.
  useEffect(() => {
    setNote("");
  }, [prospect.id]);

  const events = timelineOf(prospect);

  async function save() {
    const body = note.trim();
    if (!body || saving) return;
    setSaving(true);
    await onAddNote(body);
    setNote("");
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      {/* Kompozytor notatki */}
      <div style={{ flexShrink: 0 }}>
        <textarea
          placeholder="Dodaj notatkę…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          rows={3}
          autoFocus={autoFocusComposer}
          style={{ ...inputStyle, resize: "vertical", width: "100%", minHeight: 64 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button
            onClick={save}
            disabled={saving || !note.trim()}
            style={{ ...primaryButton, opacity: saving || !note.trim() ? 0.5 : 1 }}
          >
            {saving ? "Zapisywanie…" : "Zapisz notatkę"}
          </button>
        </div>
      </div>

      {/* Oś czasu */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${tokens.borderSoft}`, paddingTop: 12, flex: 1, minHeight: 0, overflowY: "auto" }} className="selltic-scroll-y">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted, marginBottom: 10 }}>
          Historia kontaktu
        </div>
        {events.length === 0 ? (
          <p style={{ fontSize: 12.5, color: tokens.muted, margin: 0 }}>
            Jeszcze nic się nie wydarzyło — notatki i zmiany statusu pojawią się tutaj.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {events.map((e, i) => {
              const color = eventColor(e, tokens);
              const last = i === events.length - 1;
              return (
                <div key={e.id} style={{ display: "flex", gap: 10, position: "relative", paddingBottom: last ? 0 : 14 }}>
                  {/* Pionowa linia osi czasu */}
                  {!last && (
                    <span style={{ position: "absolute", left: 11, top: 24, bottom: 0, width: 1, background: tokens.borderSoft }} />
                  )}
                  <span
                    style={{
                      width: 23,
                      height: 23,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: `${color}14`,
                      border: `1px solid ${color}30`,
                      display: "grid",
                      placeItems: "center",
                      zIndex: 1,
                    }}
                  >
                    <MIcon name={eventIcon(e)} size={13} color={color} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{eventLabel(e)}</span>
                      <span title={formatDateTime(e.created_at)} style={{ fontSize: 11.5, color: tokens.muted }}>
                        {formatRelative(e.created_at)}
                      </span>
                    </div>
                    {e.type === "note" && e.body && (
                      <div style={{ fontSize: 13, color: tokens.text, marginTop: 3, whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>
                        {e.body}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, color: tokens.muted, marginTop: 2 }}>{formatDateTime(e.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
