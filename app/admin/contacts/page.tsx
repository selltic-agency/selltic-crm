// app/admin/contacts/page.tsx — Lista kontaktów (tabela).
// Faza 9.6: dedykowana strona dla tożsamości (osób/firm). Tylko widok tabeli.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
} from "@/lib/ui";
import { type Contact } from "@/lib/types";
import ContactTable from "@/components/ContactTable";
import FilterBar from "@/components/FilterBar";
import { Filter, buildFilterQuery } from "@/lib/filters";
import { useRouter } from "next/navigation";

export default function ContactsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);

  const load = useCallback(async (activeFilters: Filter[]) => {
    setLoading(true);
    let query = supabase
      .from("contacts")
      .select("*")
      .order("updated_at", { ascending: false });

    query = buildFilterQuery(query, activeFilters);

    const { data } = await query;
    setContacts((data as Contact[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load(filters);
  }, [load, filters]);

  const openContact = (id: string) => router.push(`/admin/contacts/${id}`);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Kontakty</h1>
        <button
          onClick={() => setShowAdd(true)}
          style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} />
          Dodaj kontakt
        </button>
      </div>

      <FilterBar onFilterChange={setFilters} scope="contact" />

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
          <ContactTable contacts={contacts} onRowClick={openContact} />
        </div>
      )}

      {showAdd && (
        <AddContactModal
          onClose={() => setShowAdd(false)}
          onCreated={(c) => {
            setContacts((list) => [c, ...list]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddContactModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Contact) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner: user.id,
        name: name.trim(),
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError("Nie udało się zapisać (czy e-mail nie jest już użyty?).");
      return;
    }
    if (data) onCreated(data as Contact);
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 41,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Nowy kontakt</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} color={tokens.muted} />
          </button>
        </div>

        <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
          <Field label="Nazwa / osoba">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
          </Field>
          <Field label="Firma">
            <input value={company} onChange={(e) => setCompany(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Field label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Telefon">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {error && <p style={{ color: tokens.danger, fontSize: 13, margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={ghostButton}>
              Anuluj
            </button>
            <button type="submit" disabled={saving} style={primaryButton}>
              {saving ? "Zapisywanie…" : "Dodaj"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5, flex: "1 1 140px", minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
