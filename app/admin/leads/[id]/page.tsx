// app/admin/leads/[id]/page.tsx — strona deala (Faza 10).
// Deal to samodzielny rekord: tożsamość (nazwa/e-mail/telefon/firma) +
// etap/wartość/daty razem na jednym wierszu. Aktywności są kluczowane
// wyłącznie przez deal_id.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
  CheckSquare,
  PhoneCall,
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
  type Assignee,
  type Deal,
  type Stage,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useToast } from "@/components/Toast";
import { ScoreBreakdownList } from "@/components/ScoreBreakdown";
import { parseScoreBreakdown } from "@/lib/scoreBreakdown";

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

export default function DealPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCalling = searchParams.get("from") === "calling";
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { stages, stageMeta } = useStages();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d } = await supabase
      .from("deals")
      .select("*")
      .eq("id", dealId)
      .single();

    const dealRow = d as Deal | null;
    setDeal(dealRow ?? null);

    if (dealRow) {
      const { data: a } = await supabase
        .from("activities")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });
      setActivities((a as Activity[]) ?? []);
    }
    setLoading(false);
  }, [supabase, dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStage(stage: Stage) {
    if (!deal || deal.stage === stage) return;
    const prev = deal;
    const meta = stageMeta(stage);
    const terminal = isTerminal(stage);
    // closed_at ustawiamy wchodząc na etap wygrany/przegrany; czyścimy wychodząc.
    const closed_at = terminal ? new Date().toISOString() : null;
    setDeal({ ...deal, stage, closed_at });

    const { error } = await supabase
      .from("deals")
      .update({ stage, closed_at })
      .eq("id", deal.id);
    if (error) {
      setDeal(prev);
      toast.error("Nie udało się zmienić etapu.");
      return;
    }
    const { data } = await supabase
      .from("activities")
      .insert({
        owner: deal.owner,
        deal_id: deal.id,
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

  async function saveField(field: "name" | "email" | "phone" | "company", value: string) {
    if (!deal) return;
    const clean = value.trim() || null;
    if (deal[field] === clean) return;
    setDeal({ ...deal, [field]: clean });
    await supabase.from("deals").update({ [field]: clean }).eq("id", deal.id);
  }

  async function saveValue(raw: string) {
    if (!deal) return;
    const value = raw ? Number(raw) : 0;
    if (Number(deal.value) === value) return;
    setDeal({ ...deal, value });
    await supabase.from("deals").update({ value }).eq("id", deal.id);
  }

  async function saveAssignee(raw: Assignee | "") {
    if (!deal) return;
    const assignee = raw || null;
    if (deal.assignee === assignee) return;
    setDeal({ ...deal, assignee });
    await supabase.from("deals").update({ assignee }).eq("id", deal.id);
  }

  async function saveActivity() {
    if (!deal || saving) return;

    if (tab === "task") {
      if (!taskTitle.trim()) return;
      setSaving(true);
      const due = taskDue ? new Date(taskDue).toISOString() : null;
      const { error } = await supabase.from("tasks").insert({
        owner: deal.owner,
        deal_id: deal.id,
        title: taskTitle.trim(),
        due_at: due,
      });
      if (!error) {
        const { data } = await supabase
          .from("activities")
          .insert({
            owner: deal.owner,
            deal_id: deal.id,
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
        owner: deal.owner,
        deal_id: deal.id,
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

  if (!deal) {
    return (
      <div style={{ padding: 24 }}>
        <BackLink router={router} />
        <p style={{ color: tokens.danger, marginTop: 16 }}>Nie znaleziono deala.</p>
      </div>
    );
  }

  const dealName = deal.name || "Bez nazwy";
  const title = deal.source ? `${dealName} — ${deal.source}` : dealName;

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <BackLink router={router} />
        {fromCalling && (
          <button
            onClick={() => router.push("/admin/prospecting?calling=1")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: tokens.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <PhoneCall size={15} /> Wróć do dzwonienia
          </button>
        )}
      </div>

      {/* Nagłówek deala */}
      <div style={{ margin: "14px 0 18px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{title}</h1>
        <div style={{ fontSize: 13, color: tokens.muted, marginTop: 4 }}>
          Otwarty {formatDateTime(deal.opened_at)}
          {deal.closed_at ? ` · Zamknięty ${formatDateTime(deal.closed_at)}` : ""}
        </div>
      </div>

      {/* Tożsamość */}
      <Card>
        <SectionTitle>Tożsamość</SectionTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Nazwa / osoba</span>
            <input defaultValue={deal.name ?? ""} onBlur={(e) => saveField("name", e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Firma</span>
            <input defaultValue={deal.company ?? ""} onBlur={(e) => saveField("company", e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>E-mail</span>
            <input type="email" defaultValue={deal.email ?? ""} onBlur={(e) => saveField("email", e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Telefon</span>
            <input defaultValue={deal.phone ?? ""} onBlur={(e) => saveField("phone", e.target.value)} style={inputStyle} />
          </label>
        </div>
      </Card>

      {/* Dane z Google Maps + ocena leada — tylko dla dealów ze scrapera
          (konwersja prospekt → deal przenosi tu komplet danych). */}
      <ProspectingDataCard deal={deal} />

      {/* Etapy */}
      <Card>
        <SectionTitle>Etap</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stages.map((s) => {
            const active = deal.stage === s.key;
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
        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px", maxWidth: 240 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Wartość (zł)</span>
            <input
              type="number"
              defaultValue={deal.value || ""}
              onBlur={(e) => saveValue(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 5, flex: "1 1 200px", maxWidth: 240 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Deal Owner</span>
            <select
              value={deal.assignee ?? ""}
              onChange={(e) => saveAssignee(e.target.value as Assignee | "")}
              style={inputStyle}
            >
              <option value="">Nieprzypisany</option>
              <option value="dominik">Dominik</option>
              <option value="kuba">Kuba</option>
            </select>
          </label>
        </div>
      </Card>

      {/* Kompozytor aktywności */}
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

      {/* Oś czasu deala */}
      <Card>
        <SectionTitle>Historia deala</SectionTitle>
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

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

// Dane z Google Maps + wyjaśnienie lead score, przeniesione przy konwersji
// prospekt → deal. Renderuje się tylko, gdy deal faktycznie pochodzi ze scrapera.
function ProspectingDataCard({ deal }: { deal: Deal }) {
  const hasData =
    deal.lead_score != null ||
    !!deal.place_id ||
    !!deal.website ||
    deal.google_rating != null ||
    !!deal.address ||
    !!deal.business_status;
  if (!hasData) return null;

  const scoreReasonsFallback = (deal.props as Record<string, unknown> | null)?.score_reasons;
  const mapsUrl = (deal.props as Record<string, unknown> | null)?.google_maps_url as string | undefined;
  const hasBreakdown =
    parseScoreBreakdown(deal.lead_score_breakdown, scoreReasonsFallback).items.length > 0;

  return (
    <Card>
      <SectionTitle>Dane z Google Maps</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        <DealRow label="Strona">
          {deal.website ? (
            <a href={deal.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent }}>
              {deal.website}
            </a>
          ) : (
            <span style={{ color: tokens.success, fontWeight: 700 }}>Brak strony</span>
          )}
        </DealRow>
        {deal.website_status && (
          <DealRow label="Status strony">
            {WEBSITE_STATUS_LABEL[deal.website_status] ?? deal.website_status}
          </DealRow>
        )}
        <DealRow label="Adres">{deal.address || "—"}</DealRow>
        <DealRow label="Ocena">
          {deal.google_rating != null
            ? `⭐ ${deal.google_rating} (${deal.review_count ?? 0} opinii)`
            : "—"}
        </DealRow>
        <DealRow label="Branża">{deal.industry || "—"}</DealRow>
        <DealRow label="Miasto">{deal.city || "—"}</DealRow>
        <DealRow label="Status firmy">{deal.business_status || "—"}</DealRow>
        {deal.lead_score != null && (
          <DealRow label="Lead score">
            <b>{deal.lead_score}/100</b>
          </DealRow>
        )}
        {hasBreakdown && (
          <DealRow label="Wyjaśnienie">
            <ScoreBreakdownList
              score={deal.lead_score ?? null}
              breakdown={deal.lead_score_breakdown}
              fallbackReasons={scoreReasonsFallback}
            />
          </DealRow>
        )}
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            marginTop: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 14px",
            borderRadius: 10,
            background: tokens.accentSoft,
            color: tokens.accent,
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Zobacz w Google Maps
        </a>
      )}
    </Card>
  );
}

function DealRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span style={{ width: 110, flexShrink: 0, fontSize: 13, color: tokens.muted, fontWeight: 600, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: tokens.text, minWidth: 0 }}>{children}</span>
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
