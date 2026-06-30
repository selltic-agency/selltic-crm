// app/admin/leads/[id]/page.tsx — strona leada (Faza 9.4).
// Etap (pigułki) + wartość, daty otwarcia/zamknięcia, blok „należy do
// kontaktu" oraz ZAWĘŻONA oś czasu (tylko aktywności tego leada). Aktywność
// dodana tutaj dostaje contact_id ORAZ lead_id, więc pojawia się też na
// głównej osi czasu kontaktu.
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
  User,
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
  type Lead,
  type LeadContact,
  type Stage,
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

export default function LeadPage() {
  const params = useParams<{ id: string }>();
  const leadId = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { stages, stageMeta } = useStages();

  const [lead, setLead] = useState<Lead | null>(null);
  const [contact, setContact] = useState<LeadContact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [otherLeads, setOtherLeads] = useState(0);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: l } = await supabase
      .from("leads")
      .select("*, contacts(id, name, company, email, phone, props)")
      .eq("id", leadId)
      .single();

    const leadRow = l as (Lead & { contacts: LeadContact | null }) | null;
    setLead(leadRow ?? null);
    setContact(leadRow?.contacts ?? null);

    if (leadRow) {
      const [{ data: a }, { count }] = await Promise.all([
        supabase
          .from("activities")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", leadRow.contact_id)
          .neq("id", leadId),
      ]);
      setActivities((a as Activity[]) ?? []);
      setOtherLeads(count ?? 0);
    }
    setLoading(false);
  }, [supabase, leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStage(stage: Stage) {
    if (!lead || lead.stage === stage) return;
    const prev = lead;
    const meta = stageMeta(stage);
    const terminal = isTerminal(stage);
    // closed_at ustawiamy wchodząc na etap wygrany/przegrany; czyścimy wychodząc.
    const closed_at = terminal ? new Date().toISOString() : null;
    setLead({ ...lead, stage, closed_at });

    const { error } = await supabase
      .from("leads")
      .update({ stage, closed_at })
      .eq("id", lead.id);
    if (error) {
      setLead(prev);
      toast.error("Nie udało się zmienić etapu.");
      return;
    }
    // Aktywność „etap" — na osi leada ORAZ kontaktu.
    const { data } = await supabase
      .from("activities")
      .insert({
        owner: lead.owner,
        contact_id: lead.contact_id,
        lead_id: lead.id,
        type: "stage",
        body: `Etap zmieniony na: ${meta.label}`,
      })
      .select()
      .single();
    if (data) setActivities((list) => [data as Activity, ...list]);
  }

  // Zwraca true, gdy etap jest terminalny (wygrany lub przegrany).
  function isTerminal(key: Stage): boolean {
    const s = stages.find((x) => x.key === key);
    return !!(s?.is_won || s?.is_lost);
  }

  async function saveValue(raw: string) {
    if (!lead) return;
    const value = raw ? Number(raw) : 0;
    if (Number(lead.value) === value) return;
    setLead({ ...lead, value });
    await supabase.from("leads").update({ value }).eq("id", lead.id);
  }

  async function saveActivity() {
    if (!lead || saving) return;

    if (tab === "task") {
      if (!taskTitle.trim()) return;
      setSaving(true);
      const due = taskDue ? new Date(taskDue).toISOString() : null;
      const { error } = await supabase.from("tasks").insert({
        owner: lead.owner,
        contact_id: lead.contact_id,
        title: taskTitle.trim(),
        due_at: due,
      });
      if (!error) {
        const { data } = await supabase
          .from("activities")
          .insert({
            owner: lead.owner,
            contact_id: lead.contact_id,
            lead_id: lead.id,
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
        owner: lead.owner,
        contact_id: lead.contact_id,
        lead_id: lead.id,
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

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={{ padding: 24 }}>
        <BackLink router={router} />
        <p style={{ color: tokens.danger, marginTop: 16 }}>Nie znaleziono leada.</p>
      </div>
    );
  }

  const contactName = contact?.name || "Bez nazwy";
  const title = lead.source ? `${contactName} — ${lead.source}` : contactName;

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <BackLink router={router} />

      {/* Nagłówek leada */}
      <div style={{ margin: "14px 0 18px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{title}</h1>
        <div style={{ fontSize: 13, color: tokens.muted, marginTop: 4 }}>
          Otwarty {formatDateTime(lead.opened_at)}
          {lead.closed_at ? ` · Zamknięty ${formatDateTime(lead.closed_at)}` : ""}
        </div>
      </div>

      {/* Etapy */}
      <Card>
        <SectionTitle>Etap</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stages.map((s) => {
            const active = lead.stage === s.key;
            return (
              <button
                key={s.key}
                onClick={() => changeStage(s.key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${active ? s.color : tokens.border}`,
                  background: active ? s.color : "#fff",
                  color: active ? "#fff" : tokens.muted,
                  transition: `all .15s ${tokens.ease}`,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 16, maxWidth: 240 }}>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Wartość (zł)</span>
            <input
              type="number"
              defaultValue={lead.value || ""}
              onBlur={(e) => saveValue(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
      </Card>

      {/* Należy do kontaktu */}
      <Card>
        <SectionTitle>Należy do kontaktu</SectionTitle>
        <Link
          href={`/admin/contacts/${lead.contact_id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textDecoration: "none",
            color: tokens.text,
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: tokens.accentSoft,
              color: tokens.accent,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <User size={19} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{contactName}</div>
            <div style={{ fontSize: 12.5, color: tokens.muted }}>
              {[contact?.email, contact?.phone].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </Link>
        {otherLeads > 0 && (
          <Link
            href={`/admin/contacts/${lead.contact_id}`}
            style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600, color: tokens.accent }}
          >
            Ten kontakt ma jeszcze {otherLeads} {otherLeads === 1 ? "leada" : "leadów"} →
          </Link>
        )}
      </Card>

      {/* Kompozytor aktywności (poziom leada) */}
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

      {/* Zawężona oś czasu — tylko ten lead */}
      <Card>
        <SectionTitle>Historia leada</SectionTitle>
        {activities.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak aktywności</p>
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
