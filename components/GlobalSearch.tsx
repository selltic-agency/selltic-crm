// components/GlobalSearch.tsx — globalna wyszukiwarka w topbarze.
// Szuka JEDNOCZEŚNIE po dealach i prospektach (po nazwie / e-mailu / firmie /
// mieście) oraz po numerze telefonu odpornym na formatowanie (porównanie na
// cyfrach: „500 123 456”, „500123456”, „+48500123456”, „48 500 123 456” dają
// ten sam wynik). Wynik jest wyraźnie oznaczony jako Deal lub Prospekt.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { digitsOnly } from "@/lib/phone";

type Kind = "deal" | "prospect";

type Hit = {
  kind: Kind;
  id: string;
  title: string;
  subtitle: string;
};

// Kształty wierszy zwracanych przez zapytania wyszukiwarki (tylko wybrane kolumny).
type DealHitRow = { id: string; name: string | null; email: string | null; company: string | null; phone: string | null };
type ProspectHitRow = { id: string; name: string | null; phone: string | null; city: string | null };

export default function GlobalSearch({
  onOpenContact,
  onOpenProspect,
  fullWidth,
}: {
  onOpenContact: (contactId: string) => void;
  onOpenProspect?: (prospectId: string) => void;
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
      // Escape znaków specjalnych PostgREST-owego `or`.
      const esc = term.replace(/[%,()]/g, " ").trim();
      const digits = digitsOnly(term);
      const hasDigits = digits.length >= 3;

      // Warunki tekstowe + (opcjonalnie) telefon po cyfrach (kolumna generowana).
      const dealOr = [
        `name.ilike.%${esc}%`,
        `email.ilike.%${esc}%`,
        `company.ilike.%${esc}%`,
        ...(hasDigits ? [`phone_digits.ilike.%${digits}%`] : []),
      ].join(",");
      const prospectOr = [
        `name.ilike.%${esc}%`,
        `city.ilike.%${esc}%`,
        ...(hasDigits ? [`phone_digits.ilike.%${digits}%`] : []),
      ].join(",");

      const [dealsRes, prospectsRes] = await Promise.all([
        supabase
          .from("deals")
          .select("id, name, email, company, phone")
          .or(dealOr)
          .order("updated_at", { ascending: false })
          .limit(6),
        supabase
          .from("prospects")
          .select("id, name, phone, city")
          .is("archived_at", null)
          .or(prospectOr)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      const dealHits: Hit[] = (dealsRes.data ?? []).map((d: DealHitRow) => ({
        kind: "deal",
        id: d.id,
        title: d.name || "Bez nazwy",
        subtitle: d.email || d.company || d.phone || "—",
      }));
      const prospectHits: Hit[] = (prospectsRes.data ?? []).map((p: ProspectHitRow) => ({
        kind: "prospect",
        id: p.id,
        title: p.name || "Bez nazwy",
        subtitle: [p.city, p.phone].filter(Boolean).join(" · ") || "—",
      }));

      setHits([...dealHits, ...prospectHits]);
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

  function pick(hit: Hit) {
    if (hit.kind === "deal") onOpenContact(hit.id);
    else onOpenProspect?.(hit.id);
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
          placeholder="Szukaj deali i prospektów…"
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
                key={`${h.kind}-${h.id}`}
                onClick={() => pick(h)}
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
                <KindBadge kind={h.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{h.title}</div>
                  <div style={{ fontSize: 12, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.subtitle}
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

function KindBadge({ kind }: { kind: Kind }) {
  const isDeal = kind === "deal";
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        padding: "3px 7px",
        borderRadius: 6,
        background: isDeal ? tokens.accentSoft : "rgba(26,115,231,0.10)",
        color: isDeal ? tokens.accent : "#1A73E7",
      }}
    >
      {isDeal ? "Deal" : "Prospekt"}
    </span>
  );
}
