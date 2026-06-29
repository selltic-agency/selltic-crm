// app/admin/settings/page.tsx — ustawienia: właściwości globalne + powiadomienia.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton } from "@/lib/ui";
import type { AppSettings, PropertyDef, PropertyType } from "@/lib/types";

type Tab = "properties" | "notifications";

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

      {tab === "properties" ? <PropertiesTab /> : <NotificationsTab />}
    </div>
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
