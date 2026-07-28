// components/facebook/FacebookLeadsTab.tsx — Ustawienia → Facebook Lead Ads.
//
// Jedno miejsce na całą integrację z formularzami błyskawicznymi:
//   1. Odbieranie leadów — adres do wklejenia w Make + przełącznik maili.
//   2. Conversions API — zbiór danych i token (server-side) + test połączenia.
//   3. Etapy → zdarzenia — które etapy lejka raportują jakość leada do Meta.
//   4. Formularze — mapowanie pól z Facebooka na pola deala.
//   5. Log wysyłek — czy sygnały faktycznie dochodzą (bez zgadywania).
//
// Sekrety idą przez /api/settings/facebook (token nigdy nie wraca do klienta).
// Reszta (fb_lead_forms, pipeline_stages, meta_lead_events) ma RLS na
// właściciela, więc czytamy i zapisujemy bezpośrednio przez supabase-js.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton, formatDateTime } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import { useStages } from "@/lib/stages";
import { defInScope, propLabel } from "@/lib/properties";
import { DEFAULT_FB_FIELD_MAP, humanizeFieldName } from "@/lib/fbFieldMapping";
import type { FbLeadForm, MetaLeadEvent, PipelineStage, PropertyDef } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";

// Cele mapowania pól — pary [wartość, etykieta]. `prop:<klucz>` dokładamy
// dynamicznie z właściwości własnych.
const BUILTIN_TARGETS: [string, string][] = [
  ["", "— nie mapowane —"],
  ["name", "Imię i nazwisko"],
  ["first_name", "Imię"],
  ["last_name", "Nazwisko"],
  ["email", "E-mail"],
  ["phone", "Telefon"],
  ["company", "Firma"],
  ["value", "Wartość deala"],
  ["ignore", "Pomiń"],
];

type ApiSettings = {
  datasetId: string;
  tokenConfigured: boolean;
  testEventCode: string;
  enabled: boolean;
  notify: boolean;
  fallbackPixelId: string;
  fallbackTokenConfigured: boolean;
  ingestKeyConfigured: boolean;
};

const EMPTY_SETTINGS: ApiSettings = {
  datasetId: "",
  tokenConfigured: false,
  testEventCode: "",
  enabled: false,
  notify: true,
  fallbackPixelId: "",
  fallbackTokenConfigured: false,
  ingestKeyConfigured: false,
};

const sectionStyle = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  padding: 18,
  marginBottom: 16,
} as const;

const headingStyle = { margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: tokens.text } as const;
const hintStyle = { margin: "0 0 14px", fontSize: 12.5, lineHeight: 1.5, color: tokens.muted } as const;
const labelStyle = { display: "block", fontSize: 12.5, fontWeight: 600, color: tokens.muted, marginBottom: 5 } as const;

export function FacebookLeadsTab() {
  const supabase = useMemo(() => createClient(), []);
  const { stages, reload: reloadStages } = useStages();

  const [settings, setSettings] = useState<ApiSettings>(EMPTY_SETTINGS);
  const [forms, setForms] = useState<FbLeadForm[]>([]);
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [events, setEvents] = useState<MetaLeadEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings/facebook");
    if (res.ok) setSettings({ ...EMPTY_SETTINGS, ...(await res.json()) });
  }, []);

  const loadRest = useCallback(async () => {
    const [formsRes, defsRes, eventsRes] = await Promise.all([
      supabase.from("fb_lead_forms").select("*").order("last_lead_at", { ascending: false, nullsFirst: false }),
      supabase.from("property_defs").select("*").is("archived_at", null).order("position"),
      supabase.from("meta_lead_events").select("*").order("created_at", { ascending: false }).limit(25),
    ]);
    setForms((formsRes.data as FbLeadForm[]) ?? []);
    setPropDefs(((defsRes.data as PropertyDef[]) ?? []).filter((d) => defInScope(d, "deals")));
    setEvents((eventsRes.data as MetaLeadEvent[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadSettings().catch(() => {}), loadRest().catch(() => {})]);
      setLoading(false);
    })();
  }, [loadSettings, loadRest]);

  if (loading) return <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>;

  return (
    <div style={{ maxWidth: 860 }}>
      <IngestSection settings={settings} onSaved={loadSettings} />
      <CapiSection settings={settings} onSaved={loadSettings} />
      <StageMappingSection stages={stages} onSaved={reloadStages} />
      <FormsSection forms={forms} propDefs={propDefs} stages={stages} onSaved={loadRest} />
      <EventsLogSection events={events} onRefresh={loadRest} />
    </div>
  );
}

/* ── 1. Odbieranie leadów (Make) ─────────────────────────────────────────── */
function IngestSection({ settings, onSaved }: { settings: ApiSettings; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [notify, setNotify] = useState(settings.notify);
  const [origin, setOrigin] = useState("");

  useEffect(() => setNotify(settings.notify), [settings.notify]);
  useEffect(() => setOrigin(window.location.origin), []);

  const url = `${origin}/api/leads/facebook`;

  async function saveNotify(value: boolean) {
    setNotify(value);
    const res = await fetch("/api/settings/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify: value }),
    });
    if (!res.ok) {
      setNotify(!value);
      toast.error("Nie udało się zapisać ustawienia.");
      return;
    }
    await onSaved();
  }

  return (
    <section style={sectionStyle}>
      <h3 style={headingStyle}>Odbieranie leadów z Make</h3>
      <p style={hintStyle}>
        Scenariusz w Make (moduł „Facebook Lead Ads → Watch Leads” + „HTTP → Make a request”) wysyła leady
        na ten adres. Klucz <code>FB_LEADS_KEY</code> ustawiasz w zmiennych środowiskowych Vercela i wklejasz
        w Make jako nagłówek <code>X-API-Key</code>. Ten sam lead przysłany drugi raz nie utworzy duplikatu.
      </p>

      <label style={labelStyle}>Adres endpointu (metoda POST)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input readOnly value={url} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }} />
        <button
          style={{ ...ghostButton, flexShrink: 0 }}
          onClick={() => {
            navigator.clipboard?.writeText(url);
            toast.success("Skopiowano adres.");
          }}
        >
          <MIcon name="content_copy" size={15} /> Kopiuj
        </button>
      </div>

      <StatusPill
        ok={settings.ingestKeyConfigured}
        okText="Klucz FB_LEADS_KEY ustawiony na serwerze"
        errText="Brak zmiennej FB_LEADS_KEY — endpoint zwraca 503 i odrzuca wszystkie leady"
      />

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
        <input type="checkbox" checked={notify} onChange={(e) => saveNotify(e.target.checked)} />
        Wysyłaj powiadomienie e-mail o nowym leadzie z Facebooka
      </label>
    </section>
  );
}

/* ── 2. Conversions API (sygnał jakości) ─────────────────────────────────── */
function CapiSection({ settings, onSaved }: { settings: ApiSettings; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [datasetId, setDatasetId] = useState(settings.datasetId);
  const [token, setToken] = useState("");
  const [testEventCode, setTestEventCode] = useState(settings.testEventCode);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    setDatasetId(settings.datasetId);
    setTestEventCode(settings.testEventCode);
    setEnabled(settings.enabled);
  }, [settings]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, token: token || undefined, testEventCode, enabled }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error || "Nie udało się zapisać.";
        setStatus({ kind: "err", msg });
        toast.error(msg);
      } else {
        setToken("");
        await onSaved();
        setStatus({ kind: "ok", msg: "Zapisano ✓" });
        toast.success("Zapisano ustawienia Conversions API.");
      }
    } catch {
      setStatus({ kind: "err", msg: "Błąd sieci przy zapisie." });
    }
    setSaving(false);
  }

  async function clearToken() {
    const res = await fetch("/api/settings/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearToken: true }),
    });
    if (res.ok) {
      await onSaved();
      toast.success("Token usunięty.");
    } else toast.error("Nie udało się usunąć tokenu.");
  }

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", datasetId, token: token || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (body?.ok) setStatus({ kind: "ok", msg: `Połączono ✓ — zbiór danych: ${body.datasetName}` });
      else setStatus({ kind: "err", msg: body?.error || "Meta nie potwierdziła połączenia." });
    } catch {
      setStatus({ kind: "err", msg: "Błąd sieci przy połączeniu z Meta." });
    }
    setTesting(false);
  }

  const usingFallback = !datasetId && !!settings.fallbackPixelId;

  return (
    <section style={sectionStyle}>
      <h3 style={headingStyle}>Conversions API — jakość leadów</h3>
      <p style={hintStyle}>
        Po zmianie etapu leada z Facebooka CRM wysyła do Meta zdarzenie mówiące, czy lead okazał się
        wartościowy. Dopasowanie idzie po identyfikatorze leada — bez żadnych danych osobowych w wysyłce.
        Zdarzenia „Lead” <b>nie wysyłamy</b>: Facebook zapisał je już w momencie wypełnienia formularza.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Identyfikator zbioru danych (Dataset ID)</label>
          <input
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder={settings.fallbackPixelId ? `puste = globalny pixel ${settings.fallbackPixelId}` : "np. 1234567890"}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Kod zdarzeń testowych (opcjonalnie)</label>
          <input
            value={testEventCode}
            onChange={(e) => setTestEventCode(e.target.value)}
            placeholder="TEST12345"
            style={inputStyle}
          />
        </div>
      </div>

      <label style={labelStyle}>
        Token dostępu{" "}
        {settings.tokenConfigured && <span style={{ color: tokens.success, fontWeight: 700 }}>· zapisany ✓</span>}
      </label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={settings.tokenConfigured ? "•••••••••• (zostaw puste, by nie zmieniać)" : "wklej token z Events Managera"}
          style={inputStyle}
        />
        {settings.tokenConfigured && (
          <button style={{ ...ghostButton, flexShrink: 0, color: tokens.danger }} onClick={clearToken}>
            Usuń
          </button>
        )}
      </div>

      {usingFallback && (
        <p style={{ ...hintStyle, marginBottom: 12 }}>
          Puste pola oznaczają korzystanie z globalnej konfiguracji Meta (Formularze → ustawienia Meta):
          pixel <b>{settings.fallbackPixelId}</b>
          {settings.fallbackTokenConfigured ? " z zapisanym tokenem." : " — ale bez zapisanego tokenu CAPI."}
        </p>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Wysyłaj zdarzenia jakości leada do Meta
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={primaryButton} onClick={save} disabled={saving}>
          <MIcon name="check" size={15} /> {saving ? "Zapisywanie…" : "Zapisz"}
        </button>
        <button style={ghostButton} onClick={test} disabled={testing}>
          <MIcon name="cable" size={15} /> {testing ? "Sprawdzam…" : "Sprawdź połączenie"}
        </button>
        {status && (
          <span style={{ fontSize: 12.5, color: status.kind === "ok" ? tokens.success : tokens.danger }}>
            {status.msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ── 3. Etapy lejka → zdarzenia Meta ─────────────────────────────────────── */
function StageMappingSection({ stages, onSaved }: { stages: PipelineStage[]; onSaved: () => Promise<void> }) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, { name: string; enabled: boolean }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, { name: string; enabled: boolean }> = {};
    for (const s of stages) next[s.id] = { name: s.meta_event_name ?? "", enabled: !!s.meta_event_enabled };
    setDraft(next);
  }, [stages]);

  function isDirty(s: PipelineStage): boolean {
    const d = draft[s.id];
    if (!d) return false;
    return d.name !== (s.meta_event_name ?? "") || d.enabled !== !!s.meta_event_enabled;
  }

  async function save(s: PipelineStage) {
    const d = draft[s.id];
    if (!d) return;
    setSavingId(s.id);
    const { error } = await supabase
      .from("pipeline_stages")
      .update({ meta_event_name: d.name.trim() || null, meta_event_enabled: d.enabled && !!d.name.trim() })
      .eq("id", s.id);
    setSavingId(null);
    if (error) {
      toast.error(
        /column/i.test(error.message || "")
          ? "Baza nie ma kolumn mapowania. Uruchom migrację migration_facebook_leads.sql."
          : "Nie udało się zapisać mapowania."
      );
      return;
    }
    await onSaved();
    toast.success("Mapowanie zapisane.");
  }

  return (
    <section style={sectionStyle}>
      <h3 style={headingStyle}>Etapy lejka → zdarzenia w Meta</h3>
      <p style={hintStyle}>
        Nazwa zdarzenia musi być identyczna z tą skonfigurowaną w Events Managerze (Ustawienia zdarzeń CRM).
        Każdy etap raportujemy dla danego leada tylko raz — powrót na etap nie generuje duplikatu.
        Etap wygrany dokłada do zdarzenia wartość deala, żeby Meta optymalizowała pod przychód.
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        {stages.map((s) => {
          const d = draft[s.id] ?? { name: "", enabled: false };
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: `1px solid ${tokens.border}`,
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color, flexShrink: 0 }} />
              <span style={{ width: 140, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{s.label}</span>
              <input
                value={d.name}
                onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, name: e.target.value } })}
                placeholder="np. Qualified (puste = nie raportuj)"
                style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              />
              <label
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: tokens.muted, flexShrink: 0 }}
              >
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, enabled: e.target.checked } })}
                />
                Aktywne
              </label>
              {isDirty(s) && (
                <button style={{ ...primaryButton, flexShrink: 0 }} onClick={() => save(s)} disabled={savingId === s.id}>
                  {savingId === s.id ? "…" : "Zapisz"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── 4. Formularze błyskawiczne + mapowanie pól ──────────────────────────── */
function FormsSection({
  forms,
  propDefs,
  stages,
  onSaved,
}: {
  forms: FbLeadForm[];
  propDefs: PropertyDef[];
  stages: PipelineStage[];
  onSaved: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const targets: [string, string][] = [
    ...BUILTIN_TARGETS,
    ...propDefs.map((d) => [`prop:${d.key}`, `Właściwość: ${propLabel(d)}`] as [string, string]),
  ];

  function open(form: FbLeadForm) {
    setOpenId(form.fb_form_id);
    // Pola standardowe Facebooka mają mapowanie domyślne — pokazujemy je jako
    // wybraną wartość, żeby lista nie sugerowała, że `email` nigdzie nie trafia.
    const initial: Record<string, string> = {};
    for (const field of form.known_fields ?? []) {
      initial[field] = form.field_map?.[field] ?? DEFAULT_FB_FIELD_MAP[field] ?? "";
    }
    setDraft({ ...initial, ...(form.field_map ?? {}) });
    setStage(form.default_stage ?? "");
  }

  async function save(form: FbLeadForm) {
    setSaving(true);
    // Puste cele usuwamy z mapy — brak wpisu znaczy „nie mapowane”, a nie
    // „zmapowane na nic”; dzięki temu domyślne nazwy pól FB nadal działają.
    const cleaned = Object.fromEntries(Object.entries(draft).filter(([, v]) => v));
    const { error } = await supabase
      .from("fb_lead_forms")
      .update({ field_map: cleaned, default_stage: stage || null })
      .eq("fb_form_id", form.fb_form_id);
    setSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać mapowania.");
      return;
    }
    setOpenId(null);
    await onSaved();
    toast.success("Mapowanie formularza zapisane.");
  }

  async function toggleEnabled(form: FbLeadForm) {
    const { error } = await supabase
      .from("fb_lead_forms")
      .update({ enabled: !form.enabled })
      .eq("fb_form_id", form.fb_form_id);
    if (error) toast.error("Nie udało się zmienić stanu formularza.");
    else await onSaved();
  }

  return (
    <section style={sectionStyle}>
      <h3 style={headingStyle}>Formularze błyskawiczne</h3>
      <p style={hintStyle}>
        Formularze pojawiają się tu automatycznie po pierwszym leadzie. Pola standardowe Facebooka
        (<code>full_name</code>, <code>email</code>, <code>phone_number</code>) są rozpoznawane bez konfiguracji —
        mapowanie potrzebne jest dla pytań własnych. Odpowiedzi bez mapowania i tak trafiają na oś czasu leada,
        więc nic nie ginie.
      </p>

      {forms.length === 0 && (
        <p style={{ fontSize: 13, color: tokens.muted }}>
          Brak formularzy. Pojawią się po pierwszym leadzie przysłanym z Make.
        </p>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {forms.map((f) => (
          <div key={f.fb_form_id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <MIcon name="dynamic_form" size={17} color={tokens.muted} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{f.label || f.fb_form_id}</div>
                <div style={{ fontSize: 11.5, color: tokens.muted }}>
                  ID {f.fb_form_id} · leadów: {f.leads_count} ·{" "}
                  {f.last_lead_at ? `ostatni: ${formatDateTime(f.last_lead_at)}` : "brak leadów"}
                </div>
              </div>
              <button style={ghostButton} onClick={() => toggleEnabled(f)}>
                {f.enabled ? "Wyłącz" : "Włącz"}
              </button>
              <button style={ghostButton} onClick={() => (openId === f.fb_form_id ? setOpenId(null) : open(f))}>
                <MIcon name="tune" size={15} /> Mapowanie pól
              </button>
            </div>

            {openId === f.fb_form_id && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${tokens.borderSoft}` }}>
                <label style={labelStyle}>Etap startowy</label>
                <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">— pierwszy etap lejka —</option>
                  {stages.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <label style={labelStyle}>Pola formularza</label>
                {(f.known_fields ?? []).length === 0 && (
                  <p style={{ fontSize: 12.5, color: tokens.muted }}>
                    Pola pojawią się po pierwszym leadzie z tego formularza.
                  </p>
                )}
                <div style={{ display: "grid", gap: 6 }}>
                  {(f.known_fields ?? []).map((field) => (
                    <div key={field} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ width: 220, fontSize: 12.5, fontFamily: "monospace", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={`${humanizeFieldName(field)} (${field})`}
                      >
                        {field}
                      </span>
                      <select
                        value={draft[field] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                        style={{ ...inputStyle, flex: 1 }}
                      >
                        {targets.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button style={primaryButton} onClick={() => save(f)} disabled={saving}>
                    <MIcon name="check" size={15} /> {saving ? "Zapisywanie…" : "Zapisz mapowanie"}
                  </button>
                  <button style={ghostButton} onClick={() => setOpenId(null)}>
                    Anuluj
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 5. Log wysyłek do Meta ──────────────────────────────────────────────── */
function EventsLogSection({ events, onRefresh }: { events: MetaLeadEvent[]; onRefresh: () => Promise<void> }) {
  return (
    <section style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={headingStyle}>Ostatnie zdarzenia wysłane do Meta</h3>
        <button style={ghostButton} onClick={() => onRefresh()}>
          <MIcon name="refresh" size={15} /> Odśwież
        </button>
      </div>
      <p style={hintStyle}>
        Nieudane wysyłki są ponawiane co godzinę (job <code>meta-lead-events</code>), więc pojedynczy błąd
        sieci nie oznacza utraty sygnału.
      </p>

      {events.length === 0 && (
        <p style={{ fontSize: 13, color: tokens.muted }}>
          Brak wysyłek. Pojawią się po pierwszej zmianie etapu leada z Facebooka.
        </p>
      )}

      {events.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: tokens.muted, textAlign: "left" }}>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Kiedy</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Zdarzenie</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Lead (FB)</th>
                <th style={{ padding: "6px 8px", fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${tokens.borderSoft}` }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{formatDateTime(e.created_at)}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.event_name}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{e.fb_lead_id}</td>
                  <td style={{ padding: "6px 8px", color: e.ok ? tokens.success : tokens.danger }}>
                    {e.ok ? "wysłane ✓" : `błąd${e.status ? ` (${e.status})` : ""}: ${e.error ?? "—"}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusPill({ ok, okText, errText }: { ok: boolean; okText: string; errText: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        color: ok ? tokens.success : tokens.danger,
        background: ok ? "rgba(24,169,87,0.10)" : "rgba(229,72,77,0.10)",
      }}
    >
      <MIcon name={ok ? "check_circle" : "error"} size={15} />
      {ok ? okText : errText}
    </div>
  );
}
