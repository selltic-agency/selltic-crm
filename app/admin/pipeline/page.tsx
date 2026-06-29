// app/admin/pipeline/page.tsx — lejek sprzedaży (kanban).
// 5 kolumn etapów; karty kontaktów; klik karty otwiera ContactDrawer.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
  formatPLN,
} from "@/lib/ui";
import { type Contact, type Stage, STAGES } from "@/lib/types";
import ContactDrawer from "@/components/ContactDrawer";

export default function PipelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerContact, setDrawerContact] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .order("updated_at", { ascending: false });
    setContacts((data as Contact[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const byStage = useMemo(() => {
    const map: Record<Stage, Contact[]> = {
      new: [],
      contact: [],
      offer: [],
      won: [],
      lost: [],
    };
    for (const c of contacts) (map[c.stage] ?? map.new).push(c);
    return map;
  }, [contacts]);

  // Po zamknięciu panelu odśwież (etap mógł się zmienić w drawerze).
  function closeDrawer() {
    setDrawerContact(null);
    load();
  }

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
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Lejek</h1>
        <button
          onClick={() => setShowAdd(true)}
          style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} />
          Dodaj kontakt
        </button>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`,
            gap: 14,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {STAGES.map((s) => {
            const list = byStage[s.key];
            const total = list.reduce((sum, c) => sum + Number(c.value || 0), 0);
            return (
              <div key={s.key} style={{ minWidth: 220 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    padding: "0 2px",
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{s.label}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: tokens.muted,
                      background: tokens.card,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: 999,
                      padding: "1px 8px",
                    }}
                  >
                    {list.length}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: tokens.muted }}>
                    {formatPLN(total)}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    background: tokens.bg,
                    borderRadius: 12,
                    minHeight: 60,
                    padding: 4,
                  }}
                >
                  {list.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: tokens.muted, padding: "12px 8px", margin: 0 }}>
                      Brak kontaktów
                    </p>
                  ) : (
                    list.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setDrawerContact(c.id)}
                        style={{
                          textAlign: "left",
                          background: tokens.card,
                          border: `1px solid ${tokens.border}`,
                          borderRadius: 12,
                          padding: "12px 13px",
                          cursor: "pointer",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {c.name || "Bez nazwy"}
                        </div>
                        {c.company && (
                          <div style={{ fontSize: 12.5, color: tokens.muted }}>{c.company}</div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 11.5, color: tokens.muted }}>
                            {c.source ? `📋 ${c.source}` : "ręcznie"}
                          </span>
                          {Number(c.value) > 0 && (
                            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{formatPLN(c.value)}</span>
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

      {drawerContact && <ContactDrawer contactId={drawerContact} onClose={closeDrawer} />}
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
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<Stage>("new");
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
        value: value ? Number(value) : 0,
        stage,
        source: "ręcznie",
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
          <div style={{ display: "flex", gap: 12 }}>
            <Field label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Telefon">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Field label="Wartość (zł)">
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Etap">
              <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} style={inputStyle}>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
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
    <label style={{ display: "grid", gap: 5, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
