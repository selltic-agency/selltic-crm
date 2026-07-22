// components/forms/AllSubmissions.tsx — GLOBALNA lista zgłoszeń (wszystkie
// formularze) — zakładka „Zgłoszenia" na stronie Formularze. Przeniesione z
// dawnej, osobnej strony /admin/inbox (funkcjonalność zachowana: najnowsze
// pierwsze, link do formularza i do deala utworzonego ze zgłoszenia).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime, thStyle, tdStyle } from "@/lib/ui";
import type { Submission } from "@/lib/types";
import { useStages } from "@/lib/stages";
import EmptyState from "@/components/EmptyState";
import MIcon from "@/components/MaterialIcon";

export default function AllSubmissions({ onOpenForm }: { onOpenForm?: (formId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("submissions")
      .select("*, forms(id, title), deals(id, name, email, stage)")
      .order("created_at", { ascending: false });
    setSubmissions((data as Submission[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>;

  if (submissions.length === 0) {
    return (
      <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
        <EmptyState
          title="Brak zgłoszeń"
          description="Wypełnienia opublikowanych formularzy pojawią się tutaj automatycznie."
        />
      </div>
    );
  }

  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }} className="selltic-scroll-x">
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: "#FAFAFB" }}>
              <th style={thStyle}>Formularz</th>
              <th style={thStyle}>Zgłoszono</th>
              <th style={thStyle}>Deal</th>
              <th style={thStyle}>Etap</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr
                key={s.id}
                style={{ borderBottom: `1px solid ${tokens.borderSoft}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFAFB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={tdStyle}>
                  {s.forms ? (
                    <button
                      onClick={() => onOpenForm?.(s.forms!.id)}
                      style={{ ...linkStyle, border: "none", background: "none", cursor: onOpenForm ? "pointer" : "default", padding: 0, font: "inherit" }}
                    >
                      {s.forms.title || "Bez tytułu"}
                    </button>
                  ) : (
                    <span style={{ color: tokens.muted }}>Usunięty formularz</span>
                  )}
                </td>
                <td style={tdStyle}>{formatDateTime(s.created_at)}</td>
                <td style={tdStyle}>
                  {s.deals ? (
                    <Link href={`/admin/leads/${s.deals.id}`} style={linkStyle}>
                      {s.deals.name || s.deals.email || "Bez nazwy"}
                      <MIcon name="open_in_new" size={12} />
                    </Link>
                  ) : (
                    <span style={{ color: tokens.muted }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {s.deals ? (
                    <Link href={`/admin/leads/${s.deals.id}`} style={linkStyle}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: stageMeta(s.deals.stage).color, flexShrink: 0 }} />
                      {stageMeta(s.deals.stage).label}
                    </Link>
                  ) : (
                    <span style={{ color: tokens.muted }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  color: tokens.accent,
  fontWeight: 500,
  textDecoration: "none",
  fontSize: 13,
};
