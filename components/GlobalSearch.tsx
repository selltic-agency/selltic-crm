// components/GlobalSearch.tsx — globalna wyszukiwarka (kompaktowa, w sidebarze).
// Szuka JEDNOCZEŚNIE po dealach i prospektach (po nazwie / e-mailu / firmie /
// mieście) oraz po numerze telefonu odpornym na formatowanie (porównanie na
// cyfrach). Wynik jest wyraźnie oznaczony jako Deal lub Prospekt. W wariancie
// sidebar panel wyników jest pozycjonowany fixed (szerszy niż sam sidebar).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, menuPanel } from "@/lib/ui";
import { digitsOnly } from "@/lib/phone";
import MIcon from "@/components/MaterialIcon";

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
  variant = "default",
}: {
  onOpenContact: (contactId: string) => void;
  onOpenProspect?: (prospectId: string) => void;
  /** 'sidebar' = kompaktowe pole; panel wyników wychodzi poza sidebar. */
  variant?: "default" | "sidebar";
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
  const sidebar = variant === "sidebar";

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, maxWidth: sidebar ? "none" : 420 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: sidebar ? "#fff" : tokens.bg,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radiusSm,
          padding: sidebar ? "4px 8px" : "6px 10px",
        }}
      >
        <MIcon name="search" size={15} color={tokens.muted} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Szukaj…"
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 13,
            width: "100%",
            color: tokens.text,
            boxShadow: "none",
          }}
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setHits([]);
            }}
            aria-label="Wyczyść"
            style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "grid", placeItems: "center", color: tokens.muted }}
          >
            <MIcon name="close" size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          style={{
            ...menuPanel,
            position: "absolute",
            top: "100%",
            marginTop: 6,
            left: 0,
            width: sidebar ? "min(380px, calc(100vw - 24px))" : "100%",
            zIndex: 95,
          }}
        >
          {loading ? (
            <p style={{ padding: 14, margin: 0, color: tokens.muted, fontSize: 13 }}>Szukam…</p>
          ) : hits.length === 0 ? (
            <p style={{ padding: 14, margin: 0, color: tokens.muted, fontSize: 13 }}>
              Brak wyników dla „{q.trim()}”.
            </p>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.id}`}
                onClick={() => pick(h)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  borderTop: i === 0 ? "none" : `1px solid ${tokens.borderSoft}`,
                  background: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <KindBadge kind={h.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{h.title}</div>
                  <div style={{ fontSize: 11.5, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        padding: "2px 6px",
        borderRadius: tokens.radiusSm,
        background: isDeal ? tokens.accentSoft : tokens.infoSoft,
        color: isDeal ? tokens.accent : tokens.info,
      }}
    >
      {isDeal ? "Deal" : "Prospekt"}
    </span>
  );
}
