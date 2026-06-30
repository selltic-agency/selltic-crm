// components/ContactDrawer.tsx — wysuwany panel kontaktu (slide-in z prawej).
// Etapy lejka, edytowalne właściwości (stałe + dynamiczne), kompozytor
// aktywności i oś czasu. Zapis w czasie rzeczywistym do Supabase.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  X,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
  CheckSquare,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  formatDateTime,
} from "@/lib/ui";
import {
  type Activity,
  type ActivityType,
  type Contact,
  type PropertyDef,
} from "@/lib/types";
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

export default function ContactDrawer({
  contactId,
  onClose,
}: {
  contactId: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const reduce = useReducedMotion();
  const [contact, setContact] = useState<Contact | null>(null);
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: d }, { data: a }] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", contactId).single(),
      supabase.from("property_defs").select("*").order("position", { ascending: true }),
      supabase
        .from("activities")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
    ]);
    setContact((c as Contact) ?? null);
    setDefs((d as PropertyDef[]) ?? []);
    setActivities((a as Activity[]) ?? []);
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // Esc zamyka panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Zapis pojedynczej właściwości dynamicznej (props JSON).
  async function saveProp(key: string, value: string) {
    if (!contact) return;
    const nextProps = { ...(contact.props ?? {}), [key]: value };
    setContact({ ...contact, props: nextProps });
    await supabase.from("contacts").update({ props: nextProps }).eq("id", contact.id);
  }

  // Zapis pól stałych (email/phone) inline.
  async function saveField(field: "email" | "phone", value: string) {
    if (!contact) return;
    setContact({ ...contact, [field]: value });
    await supabase.from("contacts").update({ [field]: value }).eq("id", contact.id);
  }

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
        // odnotuj aktywność „zadanie”
        const { data } = await supabase
          .from("activities")
          .insert({
            owner: contact.owner,
            contact_id: contact.id,
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

  return (
    <>
      {/* scrim */}
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.2 }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,18,28,0.40)",
          zIndex: 40,
        }}
      />
      {/* panel */}
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={{ x: reduce ? 0 : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
        transition={
          reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }
        }
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(460px, 100vw)",
          background: tokens.card,
          borderLeft: `1px solid ${tokens.border}`,
          boxShadow: "-12px 0 40px rgba(15,18,28,0.12)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px",
            borderBottom: `1px solid ${tokens.border}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {contact?.name || "Bez nazwy"}
            </div>
            <div style={{ fontSize: 13, color: tokens.muted }}>
              {contact?.company || "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <X size={18} color={tokens.muted} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {loading ? (
            <p style={{ color: tokens.muted, fontSize: 14 }}>Wczytywanie…</p>
          ) : !contact ? (
            <p style={{ color: tokens.danger, fontSize: 14 }}>
              Nie znaleziono kontaktu.
            </p>
          ) : (
            <>
              {/* Właściwości */}
              <SectionTitle>Właściwości</SectionTitle>
              <div style={{ display: "grid", gap: 12, marginBottom: 8 }}>
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
              <p style={{ fontSize: 12, color: tokens.muted, margin: "4px 0 22px" }}>
                Pola zarządzasz w Ustawienia → Właściwości
              </p>

              {/* Kompozytor aktywności */}
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
                <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
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
                  <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                    {saving ? "Zapisywanie…" : "Dodaj zadanie"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
                  <textarea
                    placeholder="Treść…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                  <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                    {saving ? "Zapisywanie…" : "Zapisz"}
                  </button>
                </div>
              )}

              {/* Oś czasu */}
              <SectionTitle>Historia</SectionTitle>
              {activities.length === 0 ? (
                <p style={{ fontSize: 14, color: tokens.muted }}>Brak aktywności</p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {activities.map((a) => {
                    const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
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
                        <div style={{ minWidth: 0 }}>
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
            </>
          )}
        </div>
      </motion.aside>
    </>
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
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
