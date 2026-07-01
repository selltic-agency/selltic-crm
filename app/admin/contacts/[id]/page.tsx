// app/admin/contacts/[id]/page.tsx — strona kontaktu.
// Kontakt to lekka tożsamość powstająca przy kwalifikacji prospektu (dedup
// po telefonie) — grupuje deale tego samego telefonu. Nie zastępuje modelu
// deali z Fazy 10, to opcjonalne powiązanie (deals.contact_id).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, formatDateTime } from "@/lib/ui";
import type { Contact, Deal } from "@/lib/types";
import { useStages } from "@/lib/stages";

export default function ContactPage() {
  const params = useParams<{ id: string }>();
  const contactId = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();

  const [contact, setContact] = useState<Contact | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: c } = await supabase.from("contacts").select("*").eq("id", contactId).single();
    setContact((c as Contact) ?? null);

    if (c) {
      const { data: d } = await supabase
        .from("deals")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      setDeals((d as Deal[]) ?? []);
    }
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div style={{ padding: 24 }}>
        <BackLink router={router} />
        <p style={{ color: tokens.danger, marginTop: 16 }}>Nie znaleziono kontaktu.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <BackLink router={router} />

      <div style={{ margin: "14px 0 18px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{contact.name || "Bez nazwy"}</h1>
        <div style={{ fontSize: 13, color: tokens.muted, marginTop: 4 }}>
          Utworzono {formatDateTime(contact.created_at)}
        </div>
      </div>

      <Card>
        <SectionTitle>Tożsamość</SectionTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Nazwa / osoba" value={contact.name} />
          <Field label="Telefon" value={contact.phone} />
          <Field label="Firma" value={contact.company} />
        </div>
        {Object.keys(contact.props ?? {}).length > 0 && (
          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.entries(contact.props).map(([key, value]) => (
              <Field key={key} label={key} value={value == null ? null : String(value)} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Deale tego kontaktu ({deals.length})</SectionTitle>
        {deals.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak deali dla tego kontaktu.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {deals.map((d) => {
              const meta = stageMeta(d.stage);
              return (
                <div
                  key={d.id}
                  onClick={() => router.push(`/admin/leads/${d.id}`)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 12,
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name || "Bez nazwy"}</div>
                    <div style={{ fontSize: 12, color: tokens.muted }}>
                      {d.source || "—"} · Otwarty {formatDateTime(d.opened_at)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: `${meta.color}1A`,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <label style={{ display: "grid", gap: 5, flex: "1 1 200px" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <input defaultValue={value ?? ""} readOnly style={{ ...inputStyle, background: tokens.bg }} />
    </label>
  );
}

function BackLink({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <button
      onClick={() => router.back()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "none",
        cursor: "pointer",
        color: tokens.muted,
        fontSize: 13,
        fontWeight: 600,
        padding: 0,
      }}
    >
      <ArrowLeft size={16} />
      Wstecz
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 18,
        marginBottom: 16,
      }}
    >
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: "0 0 12px",
      }}
    >
      {children}
    </h3>
  );
}
