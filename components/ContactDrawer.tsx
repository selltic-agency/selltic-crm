// components/ContactDrawer.tsx — wsuwana z prawej szuflada kontaktu.
// Etapy, edytowalne właściwości, kompozytor aktywności i oś czasu — zapis na żywo do Supabase.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  STAGES,
  stageById,
  type Activity,
  type ActivityType,
  type Contact,
  type PropertyDef,
  type StageId,
} from "@/lib/types";
import { formatDateTime, sourceLabel, tokens } from "@/lib/design";

type ComposerTab = "note" | "call" | "email" | "task";

const TYPE_META: Record<ActivityType, { label: string; icon: LucideIcon }> = {
  note: { label: "Notatka", icon: StickyNote },
  call: { label: "Telefon", icon: Phone },
  email: { label: "Email", icon: Mail },
  submission: { label: "Formularz", icon: FileText },
  stage: { label: "Etap", icon: CircleDot },
};

const COMPOSER_TABS: { id: ComposerTab; label: string }[] = [
  { id: "note", label: "Notatka" },
  { id: "call", label: "Telefon" },
  { id: "email", label: "Email" },
  { id: "task", label: "Zadanie" },
];

export default function ContactDrawer({
  contact,
  propertyDefs,
  onClose,
  onContactChange,
}: {
  contact: Contact;
  propertyDefs: PropertyDef[];
  onClose: () => void;
  onContactChange: (c: Contact) => void;
}) {
  const supabase = createClient();
  const [stage, setStage] = useState<StageId>(contact.stage);
  const [props, setProps] = useState<Record<string, string>>(contact.props ?? {});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  // Wczytaj oś czasu (najnowsze pierwsze).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingTimeline(true);
      const { data } = await supabase
        .from("activities")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false });
      if (active) {
        setActivities((data ?? []) as Activity[]);
        setLoadingTimeline(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [contact.id, supabase]);

  // Zamknięcie klawiszem Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Zmiana etapu → aktualizacja kontaktu + automatyczna aktywność „stage".
  async function changeStage(next: StageId) {
    if (next === stage) return;
    const prev = stage;
    setStage(next);
    const updated = { ...contact, stage: next };
    onContactChange(updated);

    const { error } = await supabase
      .from("contacts")
      .update({ stage: next })
      .eq("id", contact.id);
    if (error) {
      setStage(prev);
      onContactChange({ ...contact, stage: prev });
      return;
    }

    const { data } = await supabase
      .from("activities")
      .insert({
        owner: contact.owner,
        contact_id: contact.id,
        type: "stage",
        body: `Etap zmieniony na „${stageById(next).label}"`,
        meta: { from: prev, to: next },
      })
      .select("*")
      .single();
    if (data) setActivities((a) => [data as Activity, ...a]);
  }

  // Zapis pojedynczej właściwości (na blur / Enter).
  const saveProps = useCallback(
    async (nextProps: Record<string, string>) => {
      const { error } = await supabase
        .from("contacts")
        .update({ props: nextProps })
        .eq("id", contact.id);
      if (!error) onContactChange({ ...contact, props: nextProps });
    },
    [contact, supabase, onContactChange]
  );

  // Dodanie aktywności lub zadania.
  async function save() {
    if (saving) return;
    if (tab === "task") {
      if (!taskTitle.trim()) return;
      setSaving(true);
      await supabase.from("tasks").insert({
        owner: contact.owner,
        contact_id: contact.id,
        title: taskTitle.trim(),
        due_at: taskDue ? new Date(taskDue).toISOString() : null,
      });
      // Ślad na osi czasu, by zadanie było widoczne w historii kontaktu.
      const { data } = await supabase
        .from("activities")
        .insert({
          owner: contact.owner,
          contact_id: contact.id,
          type: "note",
          body: `Zadanie: ${taskTitle.trim()}${
            taskDue ? ` (termin ${formatDateTime(new Date(taskDue).toISOString())})` : ""
          }`,
        })
        .select("*")
        .single();
      if (data) setActivities((a) => [data as Activity, ...a]);
      setTaskTitle("");
      setTaskDue("");
      setSaving(false);
      return;
    }

    if (!body.trim()) return;
    setSaving(true);
    const { data } = await supabase
      .from("activities")
      .insert({
        owner: contact.owner,
        contact_id: contact.id,
        type: tab,
        body: body.trim(),
      })
      .select("*")
      .single();
    if (data) setActivities((a) => [data as Activity, ...a]);
    setBody("");
    setSaving(false);
  }

  const activeStage = stageById(stage);

  return (
    <div
      className="drawer-scrim"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,19,25,0.38)",
        zIndex: 50,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 100%)",
          height: "100%",
          background: tokens.card,
          boxShadow: "-12px 0 40px rgba(17,19,25,0.12)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Nagłówek */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "20px 22px",
            borderBottom: `1px solid ${tokens.border}`,
            position: "sticky",
            top: 0,
            background: tokens.card,
            zIndex: 1,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
              {contact.name || "Bez nazwy"}
            </h2>
            <p style={{ margin: "2px 0 0", color: tokens.muted, fontSize: 13 }}>
              {contact.company || "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: tokens.muted,
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Selektor etapów */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STAGES.map((s) => {
              const active = s.id === stage;
              return (
                <button
                  key={s.id}
                  onClick={() => changeStage(s.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${active ? s.color : tokens.border}`,
                    background: active ? s.color : tokens.card,
                    color: active ? "#fff" : tokens.muted,
                    transition: "background 0.18s ease, color 0.18s ease",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Właściwości */}
          <section>
            <SectionTitle>Właściwości</SectionTitle>
            <ReadOnlyRow label="Email" value={contact.email || "—"} />
            <ReadOnlyRow label="Telefon" value={contact.phone || "—"} />
            <ReadOnlyRow label="Źródło" value={sourceLabel(contact.source)} />

            {propertyDefs.map((def) => (
              <div key={def.id} style={{ marginTop: 10 }}>
                <label style={fieldLabel}>{def.key}</label>
                {def.type === "select" ? (
                  <select
                    value={props[def.key] ?? ""}
                    onChange={(e) => {
                      const next = { ...props, [def.key]: e.target.value };
                      setProps(next);
                      saveProps(next);
                    }}
                    style={fieldInput}
                  >
                    <option value="">—</option>
                    {(def.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
                    value={props[def.key] ?? ""}
                    onChange={(e) => setProps({ ...props, [def.key]: e.target.value })}
                    onBlur={() => saveProps(props)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    style={fieldInput}
                  />
                )}
              </div>
            ))}

            <p style={{ margin: "12px 0 0", fontSize: 11.5, color: tokens.muted }}>
              Pola zarządzasz w Ustawienia → Właściwości
            </p>
          </section>

          {/* Kompozytor aktywności */}
          <section>
            <SectionTitle>Dodaj aktywność</SectionTitle>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {COMPOSER_TABS.map((t) => {
                const active = t.id === tab;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      borderRadius: 9,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: `1px solid ${active ? tokens.accent : tokens.border}`,
                      background: active ? tokens.accentSoft : tokens.card,
                      color: active ? tokens.accent : tokens.muted,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {tab === "task" ? (
              <>
                <input
                  placeholder="Tytuł zadania"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  style={{ ...fieldInput, marginBottom: 8 }}
                />
                <input
                  type="datetime-local"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  style={{ ...fieldInput, marginBottom: 10 }}
                />
              </>
            ) : (
              <textarea
                placeholder={
                  tab === "note"
                    ? "Treść notatki…"
                    : tab === "call"
                    ? "Podsumowanie rozmowy…"
                    : "Treść maila…"
                }
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                style={{ ...fieldInput, resize: "vertical", marginBottom: 10 }}
              />
            )}

            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: "9px 16px",
                borderRadius: 10,
                border: "none",
                background: saving ? tokens.muted : tokens.accent,
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: saving ? "default" : "pointer",
              }}
            >
              {saving ? "Zapisywanie…" : "Zapisz"}
            </button>
          </section>

          {/* Oś czasu */}
          <section>
            <SectionTitle>Historia</SectionTitle>
            {loadingTimeline ? (
              <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
            ) : activities.length === 0 ? (
              <p style={{ color: tokens.muted, fontSize: 13 }}>Brak aktywności</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {activities.map((a) => {
                  const meta = TYPE_META[a.type] ?? TYPE_META.note;
                  const Icon = meta.icon;
                  return (
                    <div key={a.id} style={{ display: "flex", gap: 11 }}>
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          flexShrink: 0,
                          borderRadius: 9,
                          background: tokens.accentSoft,
                          color: tokens.accent,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon size={15} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "baseline",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: 0.4,
                              textTransform: "uppercase",
                              color: tokens.accent,
                            }}
                          >
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 11.5, color: tokens.muted }}>
                            {formatDateTime(a.created_at)}
                          </span>
                        </div>
                        {a.body && (
                          <p
                            style={{
                              margin: "3px 0 0",
                              fontSize: 13.5,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {a.body}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "0 0 12px",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
      }}
    >
      {children}
    </h3>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: `1px solid ${tokens.border}`,
        fontSize: 13.5,
      }}
    >
      <span style={{ color: tokens.muted }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>
        {value}
      </span>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: tokens.muted,
  marginBottom: 4,
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
  fontSize: 13.5,
  background: tokens.card,
};
