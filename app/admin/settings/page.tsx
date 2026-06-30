// app/admin/settings/page.tsx — ustawienia: właściwości globalne + powiadomienia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { Plus, Trash2, GripVertical, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import type {
  AppSettings,
  PipelineStage,
  PropertyDef,
  PropertyType,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useToast } from "@/components/Toast";

type Tab = "properties" | "stages" | "notifications";

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
      ) : (
        <NotificationsTab />
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
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lokalna kopia do edycji, synchronizowana z kontekstem przy wczytaniu.
  useEffect(() => {
    setList(ctxStages);
  }, [ctxStages]);

  // Aktualizacja pojedynczego pola etapu (lokalnie + zapis do bazy).
  async function patch(id: string, partial: Partial<PipelineStage>) {
    setList((l) => l.map((s) => (s.id === id ? { ...s, ...partial } : s)));
    await supabase.from("pipeline_stages").update(partial).eq("id", id);
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
                onChange={(e) => patch(s.id, { color: e.target.value })}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              />
            </label>

            <input
              value={s.label}
              onChange={(e) =>
                setList((l) => l.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))
              }
              onBlur={(e) => patch(s.id, { label: e.target.value.trim() || "Etap" })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: tokens.muted }}>
              <input
                type="checkbox"
                checked={s.is_won}
                onChange={(e) =>
                  patch(s.id, { is_won: e.target.checked, is_lost: e.target.checked ? false : s.is_lost })
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
                  patch(s.id, { is_lost: e.target.checked, is_won: e.target.checked ? false : s.is_won })
                }
                style={{ accentColor: tokens.danger }}
              />
              Przegrany
            </label>

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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
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
    setSettings(
      (data as AppSettings) ?? {
        owner: user.id,
        email_new_lead: true,
        email_task_due: false,
        notify_email: null,
      }
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        {
          owner: next.owner,
          email_new_lead: next.email_new_lead,
          email_task_due: next.email_task_due,
          notify_email: next.notify_email,
        },
        { onConflict: "owner" }
      );
    if (!error) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1500);
    }
  }

  if (loading || !settings) {
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
        checked={settings.email_new_lead}
        onChange={(v) => persist({ email_new_lead: v })}
      />
      <ToggleRow
        label="Przypomnienia o terminach zadań"
        desc="Wyślij e-mail, gdy zbliża się termin zadania."
        checked={settings.email_task_due}
        onChange={(v) => persist({ email_task_due: v })}
      />

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Adres e-mail do powiadomień</span>
        <input
          type="email"
          placeholder="np. leady@selltic-agency.pl"
          defaultValue={settings.notify_email ?? ""}
          onBlur={(e) => persist({ notify_email: e.target.value || null })}
          style={{ ...inputStyle, maxWidth: 360 }}
        />
      </label>

      {savedAt && (
        <span style={{ fontSize: 13, color: tokens.success, fontWeight: 600 }}>
          Zapisano ✓
        </span>
      )}
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
