// app/admin/settings/page.tsx — ustawienia: właściwości globalne + powiadomienia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { Plus, Trash2, GripVertical, X, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import type {
  AppSettings,
  PipelineStage,
  PropertyDef,
  PropertyType,
  ScraperConfig,
  ScraperConfigRule,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useToast } from "@/components/Toast";

type Tab = "properties" | "stages" | "notifications" | "scraper";

const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  google_places_api_key: "",
  max_results_per_query: 60,
  request_delay_ms: 500,
  scoring_weights: {
    brak_strony: 40,
    strona_nie_dziala: 30,
    strona_dziala: 0,
    niemobilna_bonus: 10,
  },
  scoring_rules_reviews: [
    { min_count: 1, points: 5 },
    { min_count: 15, points: 12 },
    { min_count: 50, points: 20 },
  ],
  scoring_rules_rating: [
    { min_rating: 3.0, points: 5 },
    { min_rating: 4.0, points: 10 },
    { min_rating: 4.5, points: 15 },
  ],
};

const TYPE_LABEL: Record<PropertyType, string> = {
  text: "tekst",
  number: "liczba",
  date: "data",
  select: "lista",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("properties");

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Ustawienia</h1>

      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {(
          [
            ["properties", "Właściwości"],
            ["stages", "Etapy lejka"],
            ["notifications", "Powiadomienia"],
            ["scraper", "Scraper"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 14,
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

      {tab === "properties" ? (
        <PropertiesTab />
      ) : tab === "stages" ? (
        <StagesTab />
      ) : tab === "notifications" ? (
        <NotificationsTab />
      ) : (
        <ScraperTab />
      )}
    </div>
  );
}

/* ── Etapy lejka ──────────────────────────────────────────── */
function StagesTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { stages: ctxStages, loading: ctxLoading, reload } = useStages();
  const [list, setList] = useState<PipelineStage[]>([]);
  const [deleting, setDeleting] = useState<PipelineStage | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lokalna kopia do edycji, synchronizowana z kontekstem przy wczytaniu.
  useEffect(() => {
    setList(ctxStages);
  }, [ctxStages]);

  // Edycja lokalna (bez zapisu) — label / kolor / flagi wygrany-przegrany.
  // Zapis dopiero po kliknięciu „Zapisz” w wierszu (saveRow), żeby zmiana
  // kilku pól naraz szła jednym zapytaniem zamiast osobno przy każdej zmianie.
  function editLocal(id: string, partial: Partial<PipelineStage>) {
    setList((l) => l.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  }

  // Czy wiersz różni się od ostatnio zapisanego stanu (ctxStages).
  function isRowDirty(row: PipelineStage): boolean {
    const orig = ctxStages.find((s) => s.id === row.id);
    if (!orig) return false;
    return (
      orig.label !== row.label ||
      orig.color !== row.color ||
      orig.is_won !== row.is_won ||
      orig.is_lost !== row.is_lost
    );
  }

  async function saveRow(row: PipelineStage) {
    setSavingId(row.id);
    const label = row.label.trim() || "Etap";
    const { error } = await supabase
      .from("pipeline_stages")
      .update({ label, color: row.color, is_won: row.is_won, is_lost: row.is_lost })
      .eq("id", row.id);
    setSavingId(null);
    if (error) {
      toast.error("Nie udało się zapisać etapu.");
      return;
    }
    toast.success("Etap zapisany.");
    reload();
  }

  // Zapis nowej kolejności (debounce — onReorder strzela często podczas drag).
  function persistOrder(next: PipelineStage[]) {
    setList(next);
    if (posTimer.current) clearTimeout(posTimer.current);
    posTimer.current = setTimeout(async () => {
      await Promise.all(
        next.map((s, i) =>
          s.position === i
            ? Promise.resolve()
            : supabase.from("pipeline_stages").update({ position: i }).eq("id", s.id)
        )
      );
      reload();
    }, 500);
  }

  async function addStage() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const key = `stage_${Math.random().toString(36).slice(2, 8)}`;
    const position = list.length;
    const row = {
      owner: user.id,
      key,
      label: "Nowy etap",
      color: "#6C5CE7",
      position,
      is_won: false,
      is_lost: false,
    };
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert(row)
      .select()
      .single();
    if (error || !data) {
      toast.error("Nie udało się dodać etapu.");
      return;
    }
    setList((l) => [...l, data as PipelineStage]);
    reload();
  }

  // Usuwanie: jeśli etap ma deale — wymagaj wskazania etapu zastępczego.
  async function confirmDelete(replacementKey: string) {
    if (!deleting) return;
    if (replacementKey) {
      // Faza 10: etap żyje na dealach — przepinamy je przy usuwaniu etapu.
      await supabase
        .from("deals")
        .update({ stage: replacementKey })
        .eq("stage", deleting.key);
    }
    await supabase.from("pipeline_stages").delete().eq("id", deleting.id);
    setList((l) => l.filter((s) => s.id !== deleting.id));
    setDeleting(null);
    reload();
    toast.success("Etap usunięty.");
  }

  if (ctxLoading) {
    return (
      <Section>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </Section>
    );
  }

  return (
    <Section>
      <p style={{ fontSize: 14, color: tokens.muted, margin: "0 0 16px" }}>
        Etapy lejka są wspólne dla całego CRM. Przeciągnij, by zmienić kolejność.
        „Wygrany” / „Przegrany” oznaczają etapy końcowe (do statystyk konwersji).
      </p>

      <Reorder.Group
        axis="y"
        values={list}
        onReorder={persistOrder}
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
      >
        {list.map((s) => (
          <Reorder.Item
            key={s.id}
            value={s}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: `1px solid ${tokens.border}`,
              borderRadius: 10,
              padding: "8px 12px",
              background: "#fff",
            }}
          >
            <GripVertical size={16} color={tokens.muted} style={{ cursor: "grab", flexShrink: 0 }} />

            <label
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                flexShrink: 0,
                background: s.color,
                border: `1px solid ${tokens.border}`,
                cursor: "pointer",
                position: "relative",
                overflow: "hidden",
              }}
              aria-label="Kolor etapu"
            >
              <input
                type="color"
                value={s.color}
                onChange={(e) => editLocal(s.id, { color: e.target.value })}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              />
            </label>

            <input
              value={s.label}
              onChange={(e) => editLocal(s.id, { label: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: tokens.muted }}>
              <input
                type="checkbox"
                checked={s.is_won}
                onChange={(e) =>
                  editLocal(s.id, { is_won: e.target.checked, is_lost: e.target.checked ? false : s.is_lost })
                }
                style={{ accentColor: tokens.success }}
              />
              Wygrany
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: tokens.muted }}>
              <input
                type="checkbox"
                checked={s.is_lost}
                onChange={(e) =>
                  editLocal(s.id, { is_lost: e.target.checked, is_won: e.target.checked ? false : s.is_won })
                }
                style={{ accentColor: tokens.danger }}
              />
              Przegrany
            </label>

            {isRowDirty(s) && (
              <button
                onClick={() => saveRow(s)}
                disabled={savingId === s.id}
                title="Zapisz zmiany w etapie"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: tokens.accent,
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: savingId === s.id ? "not-allowed" : "pointer",
                  flexShrink: 0,
                  opacity: savingId === s.id ? 0.7 : 1,
                }}
              >
                <Check size={14} />
                {savingId === s.id ? "Zapisywanie…" : "Zapisz"}
              </button>
            )}

            <button
              onClick={() => {
                if (list.length <= 1) {
                  toast.error("Musi pozostać co najmniej jeden etap.");
                  return;
                }
                setDeleting(s);
              }}
              aria-label="Usuń etap"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: "#fff",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Trash2 size={15} color={tokens.muted} />
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      <button
        onClick={addStage}
        style={{ ...ghostButton, marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}
      >
        <Plus size={16} /> Dodaj etap
      </button>

      {deleting && (
        <DeleteStageDialog
          stage={deleting}
          others={list.filter((s) => s.id !== deleting.id)}
          supabase={supabase}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </Section>
  );
}

function DeleteStageDialog({
  stage,
  others,
  supabase,
  onCancel,
  onConfirm,
}: {
  stage: PipelineStage;
  others: PipelineStage[];
  supabase: ReturnType<typeof createClient>;
  onCancel: () => void;
  onConfirm: (replacementKey: string) => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [replacement, setReplacement] = useState<string>(others[0]?.key ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      // Faza 10: liczymy deale na tym etapie.
      const { count: c } = await supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("stage", stage.key);
      setCount(c ?? 0);
    })();
  }, [supabase, stage.key]);

  const hasContacts = (count ?? 0) > 0;

  return (
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(420px, calc(100vw - 32px))",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 41,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Usuń etap „{stage.label}”</h2>
          <button onClick={onCancel} aria-label="Zamknij" style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}>
            <X size={15} color={tokens.muted} />
          </button>
        </div>

        {count === null ? (
          <p style={{ fontSize: 14, color: tokens.muted }}>Sprawdzanie kontaktów…</p>
        ) : hasContacts ? (
          <>
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>
              Na tym etapie jest <b>{count}</b> {count === 1 ? "kontakt" : "kontaktów"}.
              Wybierz etap, na który chcesz je przenieść:
            </p>
            <select
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              style={{ ...inputStyle, marginBottom: 18 }}
            >
              {others.map((o) => (
                <option key={o.id} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p style={{ fontSize: 14, margin: "0 0 18px" }}>
            Na tym etapie nie ma żadnych kontaktów. Czy na pewno chcesz go usunąć?
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={ghostButton}>
            Anuluj
          </button>
          <button
            disabled={busy || count === null || (hasContacts && !replacement)}
            onClick={() => {
              setBusy(true);
              onConfirm(hasContacts ? replacement : "");
            }}
            style={{ ...primaryButton, background: tokens.danger }}
          >
            {busy ? "Usuwanie…" : "Usuń etap"}
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
      }}
    >
      {children}
    </section>
  );
}

/* ── Właściwości ──────────────────────────────────────────── */
function PropertiesTab() {
  const supabase = useMemo(() => createClient(), []);
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("property_defs")
      .select("*")
      .order("position", { ascending: true });
    setDefs((data as PropertyDef[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addDef(e?: React.FormEvent) {
    e?.preventDefault();
    const key = name.trim();
    if (!key || adding) return;
    setAdding(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAdding(false);
      return;
    }
    const position = defs.length ? Math.max(...defs.map((d) => d.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("property_defs")
      .insert({ owner: user.id, key, type, position })
      .select()
      .single();
    if (!error && data) {
      setDefs((list) => [...list, data as PropertyDef]);
      setName("");
      setType("text");
    } else if (error) {
      alert("Nie udało się dodać właściwości (czy nazwa nie jest zajęta?).");
    }
    setAdding(false);
  }

  async function removeDef(def: PropertyDef) {
    const snapshot = defs;
    setDefs((list) => list.filter((d) => d.id !== def.id));
    const { error } = await supabase.from("property_defs").delete().eq("id", def.id);
    if (error) setDefs(snapshot);
  }

  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
      }}
    >
      <p style={{ fontSize: 14, color: tokens.muted, margin: "0 0 16px" }}>
        Właściwości są wspólne dla wszystkich kontaktów i pojawiają się w panelu
        kontaktu od razu po dodaniu.
      </p>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : defs.length === 0 ? (
        <p style={{ color: tokens.muted, fontSize: 14 }}>Brak właściwości.</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {defs.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: `1px solid ${tokens.border}`,
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{d.key}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: tokens.accentSoft,
                  color: tokens.accent,
                }}
              >
                {TYPE_LABEL[d.type] ?? d.type}
              </span>
              <button
                onClick={() => removeDef(d)}
                aria-label="Usuń"
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
                <Trash2 size={15} color={tokens.muted} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={addDef} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="Nazwa właściwości"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, flex: "2 1 200px" }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType)}
          style={{ ...inputStyle, flex: "1 1 130px" }}
        >
          <option value="text">tekst</option>
          <option value="number">liczba</option>
          <option value="date">data</option>
          <option value="select">lista</option>
        </select>
        <button type="submit" disabled={adding} style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} />
          Dodaj
        </button>
      </form>
    </section>
  );
}

/* ── Powiadomienia ────────────────────────────────────────── */
function NotificationsTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  // `settings` = ostatnio zapisany stan (źródło prawdy do porównań); `draft` =
  // szkic edytowany lokalnie. Wszystkie trzy pola zapisują się jednym
  // kliknięciem „Zapisz zmiany”, zamiast osobno przy każdej zmianie.
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("app_settings")
      .select("*")
      .eq("owner", user.id)
      .maybeSingle();
    const loaded =
      (data as AppSettings) ??
      {
        owner: user.id,
        email_new_lead: true,
        email_task_due: false,
        notify_email: null,
      };
    setSettings(loaded);
    setDraft(loaded);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    !!settings &&
    !!draft &&
    (draft.email_new_lead !== settings.email_new_lead ||
      draft.email_task_due !== settings.email_task_due ||
      (draft.notify_email ?? "") !== (settings.notify_email ?? ""));

  async function save() {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      {
        owner: draft.owner,
        email_new_lead: draft.email_new_lead,
        email_task_due: draft.email_task_due,
        notify_email: draft.notify_email,
      },
      { onConflict: "owner" }
    );
    setSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać powiadomień.");
      return;
    }
    setSettings(draft);
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2000);
  }

  if (loading || !draft) {
    return (
      <section
        style={{
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: 20,
        }}
      >
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </section>
    );
  }

  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
        display: "grid",
        gap: 18,
      }}
    >
      <ToggleRow
        label="E-mail przy nowym leadzie"
        desc="Wyślij powiadomienie, gdy ktoś wypełni formularz."
        checked={draft.email_new_lead}
        onChange={(v) => setDraft((d) => (d ? { ...d, email_new_lead: v } : d))}
      />
      <ToggleRow
        label="Przypomnienia o terminach zadań"
        desc="Wyślij e-mail, gdy zbliża się termin zadania."
        checked={draft.email_task_due}
        onChange={(v) => setDraft((d) => (d ? { ...d, email_task_due: v } : d))}
      />

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Adres e-mail do powiadomień</span>
        <input
          type="email"
          placeholder="np. leady@selltic-agency.pl"
          value={draft.notify_email ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, notify_email: e.target.value || null } : d))}
          style={{ ...inputStyle, maxWidth: 360 }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            ...primaryButton,
            opacity: dirty && !saving ? 1 : 0.5,
            cursor: dirty && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Zapisywanie…" : "Zapisz zmiany"}
        </button>
        {dirty ? (
          <span style={{ fontSize: 13, color: tokens.warning, fontWeight: 600 }}>Niezapisane zmiany</span>
        ) : savedAt ? (
          <span style={{ fontSize: 13, color: tokens.success, fontWeight: 600 }}>Zapisano ✓</span>
        ) : null}
      </div>
    </section>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 13, color: tokens.muted }}>{desc}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          padding: 3,
          background: checked ? tokens.accent : "#D5D9E2",
          transition: `background .2s ${tokens.ease}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "block",
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            transform: checked ? "translateX(20px)" : "translateX(0)",
            transition: `transform .2s ${tokens.ease}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

/* ── Scraper (klucz API, konfiguracja, scoring) ──────────────────────────
   Ustawienia trzymane per-klucz w tabeli scraper_config (owner, key, value
   jsonb), czytane przez Cloud Run (webhook_server.py) w czasie rzeczywistym —
   zmiana tutaj nie wymaga redeployu backendu. */
function ScraperTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [config, setConfig] = useState<ScraperConfig>(DEFAULT_SCRAPER_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.from("scraper_config").select("key,value").eq("owner", user.id);
    const next = { ...DEFAULT_SCRAPER_CONFIG };
    for (const row of data ?? []) {
      (next as unknown as Record<string, unknown>)[row.key] = row.value;
    }
    setConfig(next);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveAll(next: ScraperConfig) {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const rows = (Object.keys(next) as (keyof ScraperConfig)[]).map((key) => ({
      owner: user.id,
      key,
      value: next[key],
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("scraper_config").upsert(rows, { onConflict: "owner,key" });
    setSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać konfiguracji scrapera.");
      return;
    }
    toast.success("Zapisano konfigurację scrapera.");
  }

  if (loading) {
    return (
      <Section>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </Section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>Klucz Google Places API</h3>
        <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 10px" }}>
          Czytany przez backend scrapera na Cloud Run w czasie rzeczywistym (bez redeployu).
        </p>
        <input
          type="password"
          placeholder="AIza..."
          value={config.google_places_api_key}
          onChange={(e) => setConfig((c) => ({ ...c, google_places_api_key: e.target.value }))}
          style={{ ...inputStyle, maxWidth: 420 }}
        />
      </Section>

      <Section>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>Parametry scrapowania</h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Limit firm na zapytanie</span>
            <input
              type="number"
              min={20}
              max={180}
              step={20}
              value={config.max_results_per_query}
              onChange={(e) => setConfig((c) => ({ ...c, max_results_per_query: Number(e.target.value) }))}
              style={{ ...inputStyle, width: 160 }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Opóźnienie między zapytaniami (ms)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={config.request_delay_ms}
              onChange={(e) => setConfig((c) => ({ ...c, request_delay_ms: Number(e.target.value) }))}
              style={{ ...inputStyle, width: 220 }}
            />
          </label>
        </div>
      </Section>

      <Section>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Konfiguracja scoringu</h3>
        <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 14px" }}>
          Status strony WWW — dokładnie jeden z trzech stanów + osobny bonus za brak mobilności.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <NumField
            label="Brak strony/domeny"
            value={config.scoring_weights.brak_strony}
            onChange={(v) => setConfig((c) => ({ ...c, scoring_weights: { ...c.scoring_weights, brak_strony: v } }))}
          />
          <NumField
            label="Jest domena, nie działa"
            value={config.scoring_weights.strona_nie_dziala}
            onChange={(v) => setConfig((c) => ({ ...c, scoring_weights: { ...c.scoring_weights, strona_nie_dziala: v } }))}
          />
          <NumField
            label="Jest strona i działa"
            value={config.scoring_weights.strona_dziala}
            onChange={(v) => setConfig((c) => ({ ...c, scoring_weights: { ...c.scoring_weights, strona_dziala: v } }))}
          />
          <NumField
            label="Bonus: niemobilna"
            value={config.scoring_weights.niemobilna_bonus}
            onChange={(v) => setConfig((c) => ({ ...c, scoring_weights: { ...c.scoring_weights, niemobilna_bonus: v } }))}
          />
        </div>

        <RuleListEditor
          title="Reguły punktowe — liczba opinii"
          thresholdKey="min_count"
          thresholdLabel="min. liczba opinii"
          rules={config.scoring_rules_reviews}
          onChange={(rules) => setConfig((c) => ({ ...c, scoring_rules_reviews: rules }))}
        />
        <div style={{ height: 14 }} />
        <RuleListEditor
          title="Reguły punktowe — ocena Google"
          thresholdKey="min_rating"
          thresholdLabel="min. ocena"
          step={0.1}
          rules={config.scoring_rules_rating}
          onChange={(rules) => setConfig((c) => ({ ...c, scoring_rules_rating: rules }))}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={() => saveAll(config)} disabled={saving} style={primaryButton}>
            {saving ? "Zapisywanie…" : "Zapisz ustawienia"}
          </button>
          <button
            onClick={() => {
              setConfig(DEFAULT_SCRAPER_CONFIG);
              saveAll(DEFAULT_SCRAPER_CONFIG);
            }}
            style={ghostButton}
          >
            Przywróć wartości domyślne
          </button>
        </div>
      </Section>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: tokens.muted }}>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={inputStyle}
      />
    </label>
  );
}

function RuleListEditor({
  title,
  thresholdKey,
  thresholdLabel,
  step = 1,
  rules,
  onChange,
}: {
  title: string;
  thresholdKey: "min_count" | "min_rating";
  thresholdLabel: string;
  step?: number;
  rules: ScraperConfigRule[];
  onChange: (rules: ScraperConfigRule[]) => void;
}) {
  function patch(i: number, partial: Partial<ScraperConfigRule>) {
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...partial } : r)));
  }
  function remove(i: number) {
    onChange(rules.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...rules, { [thresholdKey]: 0, points: 0 } as ScraperConfigRule]);
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {rules.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              step={step}
              placeholder={thresholdLabel}
              value={r[thresholdKey] ?? 0}
              onChange={(e) => patch(i, { [thresholdKey]: Number(e.target.value) } as Partial<ScraperConfigRule>)}
              style={{ ...inputStyle, width: 140 }}
            />
            <span style={{ fontSize: 12.5, color: tokens.muted }}>→</span>
            <input
              type="number"
              placeholder="punkty"
              value={r.points}
              onChange={(e) => patch(i, { points: Number(e.target.value) })}
              style={{ ...inputStyle, width: 100 }}
            />
            <span style={{ fontSize: 12.5, color: tokens.muted }}>pkt</span>
            <button
              onClick={() => remove(i)}
              aria-label="Usuń regułę"
              style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <Trash2 size={13} color={tokens.muted} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} style={{ ...ghostButton, marginTop: 8, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }}>
        <Plus size={14} /> Dodaj regułę
      </button>
    </div>
  );
}
