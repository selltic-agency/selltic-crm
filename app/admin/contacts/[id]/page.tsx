// app/admin/contacts/[id]/page.tsx — strona kontaktu (Faza 9.3, układ wg rewizji 9.3-layout).
// Tożsamość + edytowalne właściwości, lista WSZYSTKICH leadów kontaktu,
// baner duplikatów oraz GŁÓWNA oś czasu (wszystkie aktywności tego kontaktu,
// niezależnie od leada). Aktywności z lead_id mają odnośnik do swojego leada.
//
// Układ: trzy kolumny w stylu HubSpot — tożsamość/właściwości (lewa),
// kompozytor + filtrowana oś czasu (środkowa, najszersza), leady (prawa).
// Poniżej ~1180px kolumny się składają w jedną. To wyłącznie zmiana
// prezentacji — logika danych (zapis pól, aktywności, leadów, flag
// duplikatów) jest niezmieniona względem pierwotnej Fazy 9.3.
"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  Plus,
  Search,
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
type FilterTab = "all" | "note" | "call" | "email" | "task";

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

const QUICK_ACTIONS: [ComposerTab, string, typeof StickyNote][] = [
  ["note", "Notatka", StickyNote],
  ["call", "Telefon", Phone],
  ["email", "Email", Mail],
  ["task", "Zadanie", CheckSquare],
];

const TIMELINE_TABS: [FilterTab, string][] = [
  ["all", "Wszystkie"],
  ["note", "Notatki"],
  ["call", "Telefony"],
  ["email", "Email"],
  ["task", "Zadania"],
];

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
  const { stages, stageMeta } = useStages();

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
  const [addingLead, setAddingLead] = useState(false);

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  // Przewinięcie + focus kompozytora przy kliknięciu skrótu (Notatka/Telefon/…).
  const composerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const [focusSignal, setFocusSignal] = useState(0);

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

  // Po zmianie taba kompozytora (przez skrót) ustaw focus na właściwym polu.
  useEffect(() => {
    if (!focusSignal) return;
    if (tab === "task") taskTitleRef.current?.focus();
    else bodyRef.current?.focus();
  }, [focusSignal, tab]);

  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const filteredActivities = useMemo(() => {
    let list = activities;
    if (filterTab !== "all") list = list.filter((a) => a.type === filterTab);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => (a.body ?? "").toLowerCase().includes(q));
    return list;
  }, [activities, filterTab, search]);

  // Klik na skrót Notatka/Telefon/Email/Zadanie: ustaw tab kompozytora,
  // przewiń do niego i przenieś focus — kompozytor i jego logika zapisu
  // są niezmienione, to wyłącznie skrót UX.
  function quickAction(t: ComposerTab) {
    setTab(t);
    setFocusSignal((n) => n + 1);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

  // Szybkie dodanie leada przypiętego do tego kontaktu — bez modala,
  // od razu przenosi na stronę nowego leada do uzupełnienia szczegółów.
  async function addLead() {
    if (!contact || addingLead) return;
    setAddingLead(true);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        owner: contact.owner,
        contact_id: contact.id,
        stage: stages[0]?.key ?? "new",
        source: "ręcznie",
      })
      .select()
      .single();
    setAddingLead(false);
    if (data) {
      router.push(`/admin/leads/${(data as Lead).id}`);
    } else if (error) {
      toast.error(`Nie udało się dodać leada: ${error.message}`);
    }
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
        <BackLink />
        <p style={{ color: tokens.danger, marginTop: 16 }}>Nie znaleziono kontaktu.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <div className="contact-grid">
        {/* ── Lewa kolumna: tożsamość, szybkie akcje, właściwości ── */}
        <div className="col-left">
          <BackLink />

          {flags.length > 0 && (
            <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
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

          <div style={{ margin: "14px 0 20px" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, wordBreak: "break-word" }}>
              {contact.name || "Bez nazwy"}
            </h1>
            <div style={{ fontSize: 14, color: tokens.muted, marginTop: 4 }}>
              {contact.company || "—"}
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Mail size={15} color={tokens.muted} style={{ flexShrink: 0 }} />
                <input
                  type="email"
                  defaultValue={contact.email ?? ""}
                  placeholder="Brak adresu e-mail"
                  onBlur={(e) => saveField("email", e.target.value)}
                  style={prominentFieldStyle}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Phone size={15} color={tokens.muted} style={{ flexShrink: 0 }} />
                <input
                  defaultValue={contact.phone ?? ""}
                  placeholder="Brak telefonu"
                  onBlur={(e) => saveField("phone", e.target.value)}
                  style={prominentFieldStyle}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {QUICK_ACTIONS.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => quickAction(key)}
                  title={`${label} — przejdź do kompozytora`}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    padding: "10px 4px",
                    borderRadius: 10,
                    border: `1px solid ${tab === key ? tokens.accent : tokens.border}`,
                    background: tab === key ? tokens.accentSoft : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <Icon size={16} color={tab === key ? tokens.accent : tokens.text} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: tokens.muted }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <Card>
            <SectionTitle>Właściwości</SectionTitle>
            <div style={{ display: "grid", gap: 12 }}>
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
              {defs.length === 0 && (
                <p style={{ fontSize: 13, color: tokens.muted, margin: 0 }}>Brak zdefiniowanych właściwości.</p>
              )}
            </div>
            <p style={{ fontSize: 12, color: tokens.muted, margin: "12px 0 0" }}>
              Pola zarządzasz w Ustawienia → Właściwości
            </p>
          </Card>
        </div>

        {/* ── Środkowa kolumna: kompozytor + filtrowana oś czasu ── */}
        <div className="col-middle">
          <Card ref={composerRef}>
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
                  ref={taskTitleRef}
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
                  ref={bodyRef}
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

          <Card>
            <SectionTitle>Oś czasu — wszystkie leady</SectionTitle>

            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {TIMELINE_TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilterTab(key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${filterTab === key ? tokens.accent : tokens.border}`,
                    background: filterTab === key ? tokens.accentSoft : "#fff",
                    color: filterTab === key ? tokens.accent : tokens.muted,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {activities.length > 0 && (
              <div style={{ position: "relative", marginBottom: 14 }}>
                <Search
                  size={14}
                  color={tokens.muted}
                  style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Szukaj w aktywnościach…"
                  style={{ ...inputStyle, paddingLeft: 34 }}
                />
              </div>
            )}

            {activities.length === 0 ? (
              <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak aktywności</p>
            ) : filteredActivities.length === 0 ? (
              <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>
                Brak wyników dla wybranego filtra.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {filteredActivities.map((a) => {
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

        {/* ── Prawa kolumna: leady powiązane z kontaktem ── */}
        <div className="col-right">
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <SectionTitle noMargin>Leady ({leads.length})</SectionTitle>
              <button
                onClick={addLead}
                disabled={addingLead}
                title="Dodaj nowego leada dla tego kontaktu"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  border: "none",
                  background: "none",
                  color: tokens.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "2px 0",
                }}
              >
                <Plus size={14} />
                Dodaj
              </button>
            </div>

            {leads.length === 0 ? (
              <p
                style={{
                  fontSize: 13,
                  color: tokens.muted,
                  background: tokens.bg,
                  border: `1px dashed ${tokens.border}`,
                  borderRadius: 12,
                  padding: 14,
                  margin: 0,
                }}
              >
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
                        display: "grid",
                        gap: 6,
                        padding: "12px 14px",
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 12,
                        textDecoration: "none",
                        color: tokens.text,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
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
                        {Number(lead.value) > 0 && (
                          <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                            {formatPLN(lead.value)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{leadLabel(lead)}</div>
                      <div style={{ fontSize: 12, color: tokens.muted }}>
                        Otwarty {formatDateTime(lead.opened_at)}
                        {lead.closed_at ? ` · Zamknięty ${formatDateTime(lead.closed_at)}` : ""}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      <style jsx>{`
        .contact-grid {
          display: grid;
          grid-template-columns: minmax(280px, 320px) minmax(0, 1fr) minmax(280px, 320px);
          grid-template-areas: "left middle right";
          gap: 20px;
          align-items: start;
        }
        .col-left {
          grid-area: left;
          position: sticky;
          top: 88px;
          max-height: calc(100vh - 112px);
          overflow-y: auto;
        }
        .col-middle {
          grid-area: middle;
          min-width: 0;
        }
        .col-right {
          grid-area: right;
          position: sticky;
          top: 88px;
          max-height: calc(100vh - 112px);
          overflow-y: auto;
        }
        @media (max-width: 1180px) {
          .contact-grid {
            grid-template-columns: 1fr;
            grid-template-areas: "left" "middle" "right";
          }
          .col-left,
          .col-right {
            position: static;
            max-height: none;
            overflow-y: visible;
          }
        }
      `}</style>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/contacts"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: tokens.muted,
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      <ArrowLeft size={16} />
      Kontakty
    </Link>
  );
}

const Card = forwardRef<HTMLDivElement, { children: React.ReactNode }>(function Card(
  { children },
  ref
) {
  return (
    <section
      ref={ref}
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
});

function SectionTitle({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <h3
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: noMargin ? 0 : "0 0 12px",
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

const prominentFieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 14,
  fontWeight: 600,
  color: tokens.text,
  background: tokens.bg,
  outline: "none",
};
