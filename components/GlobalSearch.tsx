// components/GlobalSearch.tsx — wyszukiwarka kontaktów w topbarze.
// Szuka po nazwie / e-mailu / firmie; wynik otwiera panel kontaktu.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { type Contact } from "@/lib/types";

type Hit = Pick<Contact, "id" | "name" | "email" | "company">;

export default function GlobalSearch({
  onOpenContact,
  fullWidth,
}: {
  onOpenContact: (contactId: string) => void;
  fullWidth?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Debounce zapytania (250 ms).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const esc = term.replace(/[%,]/g, " ");
      const { data } = await supabase
        .from("contacts")
        .select("id, name, email, company")
        .or(`name.ilike.%${esc}%,email.ilike.%${esc}%,company.ilike.%${esc}%`)
        .order("updated_at", { ascending: false })
        .limit(8);
      setHits((data as Hit[]) ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, supabase]);

  // Zamknij listę po kliknięciu poza polem.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(id: string) {
    onOpenContact(id);
    setOpen(false);
    setQ("");
    setHits([]);
  }

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, maxWidth: fullWidth ? "none" : 420 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: tokens.bg,
          border: `1px solid ${tokens.border}`,
          borderRadius: 10,
          padding: "8px 12px",
        }}
      >
        <Search size={16} color={tokens.muted} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Szukaj kontaktów…"
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 14,
            width: "100%",
            color: tokens.text,
          }}
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setHits([]);
            }}
            aria-label="Wyczyść"
            style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}
          >
            <X size={15} color={tokens.muted} />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          style={{
            position: "absolute",
            top: 44,
            left: 0,
            right: 0,
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            boxShadow: "0 16px 50px rgba(15,18,28,0.18)",
            zIndex: 80,
            overflow: "hidden",
          }}
        >
          {loading ? (
            <p style={{ padding: 16, margin: 0, color: tokens.muted, fontSize: 14 }}>Szukam…</p>
          ) : hits.length === 0 ? (
            <p style={{ padding: 16, margin: 0, color: tokens.muted, fontSize: 14 }}>
              Brak wyników dla „{q.trim()}”.
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={h.id}
                onClick={() => pick(h.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  borderTop: `1px solid ${tokens.border}`,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{h.name || "Bez nazwy"}</div>
                  <div style={{ fontSize: 12, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.email || h.company || "—"}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
