// app/admin/inbox/page.tsx — Zgłoszenia (Inbox): surowe wypełnienia formularzy.
// Minimalny widok przeglądowy (REQUIREMENTS.md §6.2) — tabela, najnowsze
// pierwsze, z linkiem do kontaktu/leada, które dane zgłoszenie utworzyło.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Inbox as InboxIcon, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Submission } from "@/lib/types";
import { useStages } from "@/lib/stages";

export default function InboxPage() {
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("submissions")
      .select("*, forms(id, title), contacts(id, name, email), leads(id, stage)")
      .order("created_at", { ascending: false });
    setSubmissions((data as Submission[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Zgłoszenia</h1>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : submissions.length === 0 ? (
        <div
          style={{
            background: tokens.card,
            border: `1px dashed ${tokens.border}`,
            borderRadius: tokens.radius,
            padding: 32,
            textAlign: "center",
            color: tokens.muted,
          }}
        >
          <InboxIcon size={28} style={{ marginBottom: 8, opacity: 0.6 }} />
          <p style={{ margin: 0, fontSize: 14 }}>Brak zgłoszeń. Wypełnienia formularzy pojawią się tutaj.</p>
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                <th style={thStyle}>FORMULARZ</th>
                <th style={thStyle}>ZGŁOSZONO</th>
                <th style={thStyle}>KONTAKT</th>
                <th style={thStyle}>LEAD</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                  <td style={tdStyle}>{s.forms?.title || "Usunięty formularz"}</td>
                  <td style={tdStyle}>{formatDateTime(s.created_at)}</td>
                  <td style={tdStyle}>
                    {s.contacts ? (
                      <Link href={`/admin/contacts/${s.contacts.id}`} style={linkStyle}>
                        {s.contacts.name || s.contacts.email || "Bez nazwy"}
                        <ExternalLink size={12} />
                      </Link>
                    ) : (
                      <span style={{ color: tokens.muted }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {s.leads ? (
                      <Link href={`/admin/leads/${s.leads.id}`} style={linkStyle}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: stageMeta(s.leads.stage).color,
                            flexShrink: 0,
                          }}
                        />
                        {stageMeta(s.leads.stage).label}
                        <ExternalLink size={12} />
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
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  fontSize: 12,
  fontWeight: 700,
  color: tokens.muted,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
};

const linkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: tokens.accent,
  fontWeight: 600,
  textDecoration: "none",
};
