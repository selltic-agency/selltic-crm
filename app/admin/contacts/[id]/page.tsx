// app/admin/contacts/[id]/page.tsx — strona kontaktu (Faza 9.3).
// Tożsamość + edytowalne właściwości, lista WSZYSTKICH leadów kontaktu,
// baner duplikatów oraz GŁÓWNA oś czasu (wszystkie aktywności tego kontaktu,
// niezależnie od leada). Aktywności z lead_id mają odnośnik do swojego leada.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
  CheckSquare,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
  formatDateTime,
  formatPLN,
} from "@/lib/ui";
import {
  type Activity,
  type ActivityType,
  type Contact,
  type DuplicateFlag,
  type Lead,
  type PropertyDef,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useToast } from "@/components/Toast";

type ComposerTab = "note" | "call" | "email" | "task";

const ACTIVITY_ICON: Record<string, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  submission: FileText,
  stage: CircleDot,
  task: CheckSquare,
};

const ACTIVITY_LABEL: Record<string, string> = {
  note: "Notatka",
  call: "Telefon",
  email: "E-mail",
  submission: "Zgłoszenie",
  stage: "Etap",
  task: "Zadanie",
};

// Krótka, czytelna etykieta leada (np. do badge'a na osi czasu / karcie).
function leadLabel(lead: Lead): string {
  return lead.source ? lead.source : "Lead bez źródła";
}

type FlagWithOther = DuplicateFlag & {
  other: { id: string; name: string | null; email: string | null } | null;
};

export default function ContactPage() {
  const params = useParams<{ id: string }>();
  const contactId = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { stageMeta } = useStages();

  const [contact, setContact] = useState<Contact | null>(null);
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [flags, setFlags] = useState<FlagWithOther[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: d }, { data: l }, { data: a }, { data: f }] =
      await Promise.all([
        supabase.from("contacts").select("*").eq("id", contactId).single(),
        supabase.from("property_defs").select("*").order("position", { ascending: true }),
        supabase
          .from("leads")
          .select("*")
          .eq("contact_id", contactId)
          .order("opened_at", { ascending: false }),
        supabase
          .from("activities")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        supabase
          .from("duplicate_flags")
          .select("*")
          .eq("resolved", false)
          .or(`contact_a.eq.${contactId},contact_b.eq.${contactId}`),
      ]);

    setContact((c as Contact) ?? null);
    setDefs((d as PropertyDef[]) ?? []);
    setLeads((l as Lead[]) ?? []);
    setActivities((a as Activity[]) ?? []);

    // Dla każdej flagi dobierz „drugi" kontakt (ten, który nie jest bieżącym).
    const rawFlags = (f as DuplicateFlag[]) ?? [];
    const otherIds = rawFlags.map((fl) =>
      fl.contact_a === contactId ? fl.contact_b : fl.contact_a
    );
    let others: { id: string; name: string | null; email: string | null }[] = [];
    if (otherIds.length) {
      const { data: oc } = await supabase
        .from("contacts")
        .select("id, name, email")
        .in("id", otherIds);
      others = (oc as { id: string; name: string | null; email: string | null }[]) ?? [];
    }
    const byId = new Map(others.map((o) => [o.id, o]));
    setFlags(
      rawFlags.map((fl) => ({
        ...fl,
        other: byId.get(fl.contact_a === contactId ? fl.contact_b : fl.contact_a) ?? null,
      }))
    );

    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    load();
  }, [load]);

  const leadsById = useMemo(
    () => new Map(leads.map((l) => [l.id, l])),
    [leads]
  );

  // Zapis pól stałych (email/phone) inline.
  async function saveField(field: "email" | "phone", value: string) {
    if (!contact) return;
    setContact({ ...contact, [field]: value });
    await supabase.from("contacts").update({ [field]: value }).eq("id", contact.id);
  }

  // Zapis pojedynczej właściwości dynamicznej (props JSON).
  async function saveProp(key: string, value: string) {
    if (!contact) return;
    const nextProps = { ...(contact.props ?? {}), [key]: value };
    setContact({ ...contact, props: nextProps });
    await supabase.from("contacts").update({ props: nextProps }).eq("id", contact.id);
  }

  // Aktywność na poziomie KONTAKTU (lead_id = null) — poza kontekstem leada.
  async function saveActivity() {
    if (!contact || saving) return;

    if (tab === "task") {
      if (!taskTitle.trim()) return;
      setSaving(true);
      const due = taskDue ? new Date(taskDue).toISOString() : null;
      const { error } = await supabase.from("tasks").insert({
        owner: contact.owner,
        contact_id: contact.id,
        title: taskTitle.trim(),
        due_at: due,
      });
      if (!error) {
        const { data } = await supabase
          .from("activities")
          .insert({
            owner: contact.owner,
            contact_id: contact.id,
            lead_id: null,
            type: "task",
            body: taskTitle.trim(),
            meta: due ? { due_at: due } : null,
          })
          .select()
          .single();
        if (data) setActivities((list) => [data as Activity, ...list]);
        setTaskTitle("");
        setTaskDue("");
        toast.success("Zadanie dodane.");
      } else {
        toast.error("Nie udało się dodać zadania.");
      }
      setSaving(false);
      return;
    }

    if (!body.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("activities")
      .insert({
        owner: contact.owner,
        contact_id: contact.id,
        lead_id: null,
        type: tab as ActivityType,
        body: body.trim(),
      })
      .select()
      .single();
    if (!error && data) {
      setActivities((list) => [data as Activity, ...list]);
      setBody("");
      toast.success("Aktywność dodana.");
    } else if (error) {
      toast.error("Nie udało się zapisać aktywności.");
    }
    setSaving(false);
  }

  async function resolveFlag(id: string) {
    setFlags((list) => list.filter((f) => f.id !== id));
    await supabase.from("duplicate_flags").update({ resolved: true }).eq("id", id);
    toast.success("Oznaczono jako różne kontakty.");
  }

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

      {/* Nagłówek tożsamości */}
      <div style={{ margin: "14px 0 20px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
          {contact.name || "Bez nazwy"}
        </h1>
        <div style={{ fontSize: 14, color: tokens.muted, marginTop: 4 }}>
          {contact.company || "—"}
        </div>
      </div>

      {/* Baner duplikatów */}
      {flags.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {flags.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: `${tokens.warning}14`,
                border: `1px solid ${tokens.warning}55`,
              }}
            >
              <AlertTriangle size={20} color={tokens.warning} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Możliwy duplikat</div>
                <div style={{ fontSize: 13, color: tokens.muted, marginTop: 2 }}>
                  {f.reason} ·{" "}
                  {f.other
                    ? `${f.other.name || "Bez nazwy"} (${f.other.email || "brak e-maila"})`
                    : "inny kontakt"}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button onClick={() => resolveFlag(f.id)} style={{ ...ghostButton, padding: "7px 12px", fontSize: 13 }}>
                    Oznacz jako różne
                  </button>
                  {f.other && (
                    <Link
                      href={`/admin/contacts/${f.other.id}`}
                      style={{
                        ...ghostButton,
                        padding: "7px 12px",
                        fontSize: 13,
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <ExternalLink size={14} />
                      Zobacz kontakt
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Właściwości */}
      <Card>
        <SectionTitle>Właściwości</SectionTitle>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="E-mail">
            <input
              type="email"
              defaultValue={contact.email ?? ""}
              onBlur={(e) => saveField("email", e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Telefon">
            <input
              defaultValue={contact.phone ?? ""}
              onBlur={(e) => saveField("phone", e.target.value)}
              style={inputStyle}
            />
          </Field>
          {defs.map((def) => (
            <Field key={def.id} label={def.key}>
              {def.type === "select" && def.options?.length ? (
                <select
                  defaultValue={contact.props?.[def.key] ?? ""}
                  onChange={(e) => saveProp(def.key, e.target.value)}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {def.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
                  defaultValue={contact.props?.[def.key] ?? ""}
                  onBlur={(e) => saveProp(def.key, e.target.value)}
                  style={inputStyle}
                />
              )}
            </Field>
          ))}
        </div>
        <p style={{ fontSize: 12, color: tokens.muted, margin: "12px 0 0" }}>
          Pola zarządzasz w Ustawienia → Właściwości
        </p>
      </Card>

      {/* Leady */}
      <Card>
        <SectionTitle>Leady ({leads.length})</SectionTitle>
        {leads.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>
            Ten kontakt nie ma jeszcze żadnego leada.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {leads.map((lead) => {
              const sm = stageMeta(lead.stage);
              return (
                <Link
                  key={lead.id}
                  href={`/admin/leads/${lead.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 12,
                    textDecoration: "none",
                    color: tokens.text,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: `${sm.color}1A`,
                      color: sm.color,
                      flexShrink: 0,
                    }}
                  >
                    {sm.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{leadLabel(lead)}</div>
                    <div style={{ fontSize: 12, color: tokens.muted }}>
                      Otwarty {formatDateTime(lead.opened_at)}
                      {lead.closed_at ? ` · Zamknięty ${formatDateTime(lead.closed_at)}` : ""}
                    </div>
                  </div>
                  {Number(lead.value) > 0 && (
                    <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                      {formatPLN(lead.value)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {/* Kompozytor aktywności (poziom kontaktu) */}
      <Card>
        <SectionTitle>Dodaj aktywność</SectionTitle>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {(
            [
              ["note", "Notatka"],
              ["call", "Telefon"],
              ["email", "E-mail"],
              ["task", "Zadanie"],
            ] as [ComposerTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${tab === key ? tokens.accent : tokens.border}`,
                background: tab === key ? tokens.accentSoft : "#fff",
                color: tab === key ? tokens.accent : tokens.muted,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "task" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <input
              placeholder="Tytuł zadania"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              style={inputStyle}
            />
            <input
              type="datetime-local"
              value={taskDue}
              onChange={(e) => setTaskDue(e.target.value)}
              style={inputStyle}
            />
            <div>
              <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                {saving ? "Zapisywanie…" : "Dodaj zadanie"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <textarea
              placeholder="Treść…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div>
              <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                {saving ? "Zapisywanie…" : "Zapisz"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Główna oś czasu — wszystkie aktywności kontaktu */}
      <Card>
        <SectionTitle>Historia (wszystkie leady)</SectionTitle>
        {activities.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak aktywności</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {activities.map((a) => {
              const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
              const lead = a.lead_id ? leadsById.get(a.lead_id) : null;
              return (
                <div key={a.id} style={{ display: "flex", gap: 11 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: tokens.accentSoft,
                      color: tokens.accent,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon size={15} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          textTransform: "uppercase",
                          color: tokens.accent,
                        }}
                      >
                        {ACTIVITY_LABEL[a.type] ?? a.type}
                      </span>
                      <span style={{ fontSize: 12, color: tokens.muted }}>
                        {formatDateTime(a.created_at)}
                      </span>
                      {a.lead_id && (
                        <Link
                          href={`/admin/leads/${a.lead_id}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "1px 8px",
                            borderRadius: 999,
                            background: tokens.bg,
                            border: `1px solid ${tokens.border}`,
                            color: tokens.muted,
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <CircleDot size={11} />
                          {lead ? `Lead · ${leadLabel(lead)}` : "Lead"}
                        </Link>
                      )}
                    </div>
                    {a.body && (
                      <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap" }}>
                        {a.body}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
