// app/admin/settings/page.tsx — ustawienia: właściwości globalne + powiadomienia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import type {
  AppSettings,
  CategoryKeyword,
  PipelineStage,
  PropertyDef,
  PropertyOption,
  PropertyType,
  ScraperConfig,
  ScraperConfigRule,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useClassification } from "@/lib/classification";
import { useToast } from "@/components/Toast";
import { PROPERTY_TYPES, TYPE_LABEL, hasOptions, normalizeOptions, propLabel, slugify } from "@/lib/properties";
import { ensureContactSourceDef } from "@/lib/contactSource";
import { EmailTemplatesTab } from "@/components/email/EmailTemplatesTab";
import { SmsTemplatesTab } from "@/components/sms/SmsTemplatesTab";
import MIcon from "@/components/MaterialIcon";
import { useScrollLock } from "@/lib/useScrollLock";

type Tab =
  | "general"
  | "properties"
  | "stages"
  | "categories"
  | "notifications"
  | "integrations"
  | "sms-gateway"
  | "templates"
  | "sms-templates"
  | "scraper";

// Definicja nawigacji: pogrupowane zakładki z ikoną i krótkim opisem. Grupy
// porządkują ustawienia tematycznie (lepszy UX niż płaski rząd 9 pigułek).
type TabDef = { key: Tab; label: string; icon: string; hint?: string };
type TabGroup = { group: string; items: TabDef[] };

const TAB_GROUPS: TabGroup[] = [
  {
    group: "Ogólne",
    items: [{ key: "general", label: "Ogólne", icon: "storefront", hint: "Nazwa firmy" }],
  },
  {
    group: "Konfiguracja CRM",
    items: [
      { key: "properties", label: "Właściwości", icon: "tune", hint: "Pola własne leadów" },
      { key: "stages", label: "Etapy lejka", icon: "account_tree", hint: "Kolumny pipeline'u" },
      { key: "categories", label: "Kategorie branż", icon: "sell", hint: "Mapowanie słów kluczowych" },
    ],
  },
  {
    group: "Komunikacja",
    items: [
      { key: "notifications", label: "Powiadomienia", icon: "notifications", hint: "E-maile o leadach i zadaniach" },
      { key: "integrations", label: "Wysyłka e-mail", icon: "mail", hint: "Klucz Resend" },
      { key: "sms-gateway", label: "Bramka SMS", icon: "smartphone", hint: "Token SMSAPI" },
      { key: "templates", label: "Szablony e-mail", icon: "description" },
      { key: "sms-templates", label: "Szablony SMS", icon: "chat" },
    ],
  },
  {
    group: "Zaawansowane",
    items: [{ key: "scraper", label: "Scraper", icon: "smart_toy", hint: "Google Maps + scoring" }],
  },
];

const TAB_LIST: TabDef[] = TAB_GROUPS.flatMap((g) => g.items);
const TAB_KEYS = new Set<string>(TAB_LIST.map((t) => t.key));

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

export default function SettingsPage() {
  const isMobile = useIsMobile(900);
  const [tab, setTab] = useState<Tab>("properties");

  // Zakładka z URL (?tab=…) — deep-linkowanie i odporność na przeładowanie.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TAB_KEYS.has(t)) setTab(t as Tab);
  }, []);

  const selectTab = useCallback((key: Tab) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const active = TAB_LIST.find((t) => t.key === tab) ?? TAB_LIST[0];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 4px" }}>Ustawienia</h1>
      <p style={{ fontSize: 13.5, color: tokens.muted, margin: "0 0 20px" }}>
        Konfiguracja CRM, integracji i automatyzacji. Zmiany zapisują się per sekcja.
      </p>

      {isMobile ? (
        // ── Mobile: przewijalny poziomo rząd pigułek (nie rozpycha strony) ──
        <>
          <div
            className="selltic-scroll-x"
            style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, margin: "0 -2px 16px", WebkitOverflowScrolling: "touch" }}
          >
            {TAB_LIST.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => selectTab(t.key)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    padding: "9px 14px",
                    borderRadius: 999,
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${on ? tokens.accent : tokens.border}`,
                    background: on ? tokens.accentSoft : "#fff",
                    color: on ? tokens.accent : tokens.muted,
                  }}
                >
                  <MIcon name={t.icon} size={15} /> {t.label}
                </button>
              );
            })}
          </div>
          <TabContent tab={tab} />
        </>
      ) : (
        // ── Desktop: boczna nawigacja pogrupowana + treść ──
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          <nav style={{ width: 236, flexShrink: 0, position: "sticky", top: 8, display: "grid", gap: 18 }}>
            {TAB_GROUPS.map((grp) => (
              <div key={grp.group} style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: tokens.muted, padding: "0 10px 2px" }}>
                  {grp.group}
                </span>
                {grp.items.map((t) => {
                  const on = t.key === tab;
                      return (
                    <button
                      key={t.key}
                      onClick={() => selectTab(t.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        width: "100%",
                        textAlign: "left",
                        padding: "9px 11px",
                        borderRadius: 10,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "1px solid transparent",
                        background: on ? tokens.accentSoft : "transparent",
                        color: on ? tokens.accent : tokens.text,
                        transition: `background 120ms ${tokens.ease}`,
                      }}
                    >
                      <MIcon name={t.icon} size={17} color={on ? tokens.accent : tokens.muted} style={{ flexShrink: 0 }} />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: tokens.accentSoft, color: tokens.accent, flexShrink: 0 }}>
                <MIcon name={active.icon} size={19} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.2 }}>{active.label}</div>
                {active.hint && <div style={{ fontSize: 12.5, color: tokens.muted }}>{active.hint}</div>}
              </div>
            </div>
            <TabContent tab={tab} />
          </div>
        </div>
      )}
    </div>
  );
}

// Zawartość aktywnej zakładki (jedno miejsce dla obu układów).
function TabContent({ tab }: { tab: Tab }) {
  switch (tab) {
    case "general":
      return <GeneralTab />;
    case "properties":
      return <PropertiesTab />;
    case "stages":
      return <StagesTab />;
    case "categories":
      return <CategoriesTab />;
    case "notifications":
      return <NotificationsTab />;
    case "integrations":
      return <IntegrationsTab />;
    case "sms-gateway":
      return <SmsGatewayTab />;
    case "templates":
      return <EmailTemplatesTab />;
    case "sms-templates":
      return <SmsTemplatesTab />;
    case "scraper":
      return <ScraperTab />;
    default:
      return null;
  }
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
            <MIcon name="drag_indicator" size={16} color={tokens.muted} style={{ cursor: "grab", flexShrink: 0 }} />

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
                <MIcon name="check" size={14} />
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
              <MIcon name="delete" size={15} color={tokens.muted} />
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      <button
        onClick={addStage}
        style={{ ...ghostButton, marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}
      >
        <MIcon name="add" size={16} /> Dodaj etap
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
  useScrollLock();
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
            <MIcon name="close" size={15} color={tokens.muted} />
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

/* ── Kategorie branż (Feature 1) ──────────────────────────────────────────
   Stała lista 13 kategorii (z kontekstu klasyfikacji). Ekran zarządza
   MAPOWANIEM słów kluczowych scrapera → kategoria (wiele słów → jedna
   kategoria): dodaj / usuń / przenieś słowo między kategoriami. Mapowanie
   dotyczy PRZYSZŁYCH zadań scrapowania (istniejące leady nie są przeklejane). */
function CategoriesTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { categories, loading: catLoading } = useClassification();
  const [keywords, setKeywords] = useState<CategoryKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("category_keywords")
      .select("*")
      .order("keyword", { ascending: true });
    setKeywords((data as CategoryKeyword[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const byCategory = useMemo(() => {
    const map: Record<string, CategoryKeyword[]> = {};
    for (const k of keywords) (map[k.category_key] ??= []).push(k);
    return map;
  }, [keywords]);

  const unmapped = useMemo(() => {
    const known = new Set(categories.map((c) => c.key));
    return keywords.filter((k) => !known.has(k.category_key));
  }, [keywords, categories]);

  async function addKeyword(categoryKey: string) {
    const raw = (drafts[categoryKey] ?? "").trim();
    if (!raw || busy) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    // Rozbij po przecinkach/nowych liniach — wygodne wklejanie wielu słów.
    const toAdd = [...new Set(raw.split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter(Boolean))];
    const { data, error } = await supabase
      .from("category_keywords")
      .upsert(
        toAdd.map((keyword) => ({ owner: user.id, keyword, category_key: categoryKey })),
        { onConflict: "owner,keyword" }
      )
      .select("*");
    setBusy(false);
    if (error) {
      toast.error("Nie udało się dodać słów kluczowych.");
      return;
    }
    // Upsert może odświeżyć istniejące (przeniesienie słowa do tej kategorii).
    setKeywords((list) => {
      const updated = new Map(list.map((k) => [k.id, k]));
      for (const row of (data as CategoryKeyword[]) ?? []) updated.set(row.id, row);
      // usuń stare wiersze o tym samym keyword (gdyby id się zmieniło — nie
      // zmienia się przy upsert po unique, ale na wszelki wypadek dedup po keyword)
      const seen = new Set<string>();
      return [...updated.values()]
        .filter((k) => (seen.has(k.owner + k.keyword) ? false : (seen.add(k.owner + k.keyword), true)))
        .sort((a, b) => a.keyword.localeCompare(b.keyword));
    });
    setDrafts((d) => ({ ...d, [categoryKey]: "" }));
  }

  async function removeKeyword(k: CategoryKeyword) {
    const snapshot = keywords;
    setKeywords((list) => list.filter((x) => x.id !== k.id));
    const { error } = await supabase.from("category_keywords").delete().eq("id", k.id);
    if (error) {
      setKeywords(snapshot);
      toast.error("Nie udało się usunąć słowa kluczowego.");
    }
  }

  async function moveKeyword(k: CategoryKeyword, categoryKey: string) {
    if (k.category_key === categoryKey) return;
    setKeywords((list) => list.map((x) => (x.id === k.id ? { ...x, category_key: categoryKey } : x)));
    const { error } = await supabase.from("category_keywords").update({ category_key: categoryKey }).eq("id", k.id);
    if (error) {
      toast.error("Nie udało się przenieść słowa kluczowego.");
      load();
    }
  }

  if (catLoading || loading) {
    return (
      <Section>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </Section>
    );
  }

  return (
    <Section>
      <p style={{ fontSize: 14, color: tokens.muted, margin: "0 0 18px" }}>
        Przypisz słowa kluczowe scrapera do kategorii branży (wiele słów → jedna kategoria).
        Nowe zadanie scrapowania z niezmapowanym słowem poprosi o wskazanie kategorii,
        zanim ruszy. Zmiany dotyczą <b>przyszłych</b> zadań — istniejących leadów nie
        przepinamy automatycznie (kategorię pojedynczego leada zmienisz w jego widoku
        lub zbiorczo na liście).
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {categories.map((c) => {
          const list = byCategory[c.key] ?? [];
          return (
            <div key={c.key} style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>{c.label}</span>
                <span style={{ fontSize: 12, color: tokens.muted, fontWeight: 600 }}>({list.length})</span>
              </div>

              {list.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {list.map((k) => (
                    <span
                      key={k.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 6px 4px 12px",
                        borderRadius: 999,
                        background: `${c.color}14`,
                        border: `1px solid ${c.color}33`,
                        fontSize: 13,
                        fontWeight: 600,
                        color: tokens.text,
                      }}
                    >
                      {k.keyword}
                      <select
                        value={c.key}
                        onChange={(e) => moveKeyword(k, e.target.value)}
                        title="Przenieś do innej kategorii"
                        style={{
                          border: `1px solid ${tokens.border}`,
                          borderRadius: 8,
                          background: "#fff",
                          fontSize: 11,
                          padding: "2px 4px",
                          cursor: "pointer",
                          maxWidth: 130,
                        }}
                      >
                        {categories.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeKeyword(k)}
                        aria-label={`Usuń słowo ${k.keyword}`}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 7,
                          border: "none",
                          background: "none",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          color: tokens.muted,
                        }}
                      >
                        <MIcon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Dodaj słowo kluczowe (możesz wkleić kilka po przecinku)"
                  value={drafts[c.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeyword(c.key);
                    }
                  }}
                  style={{ ...inputStyle, flex: "1 1 240px", minWidth: 0 }}
                />
                <button
                  onClick={() => addKeyword(c.key)}
                  disabled={busy || !(drafts[c.key] ?? "").trim()}
                  style={{
                    ...ghostButton,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    opacity: busy || !(drafts[c.key] ?? "").trim() ? 0.5 : 1,
                  }}
                >
                  <MIcon name="add" size={16} /> Dodaj
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {unmapped.length > 0 && (
        <p style={{ fontSize: 12.5, color: tokens.warning, marginTop: 14 }}>
          {unmapped.length} słów jest przypisanych do nieistniejących kategorii — przenieś je do
          jednej z powyższych.
        </p>
      )}
    </Section>
  );
}

/* ── Ogólne: nazwa firmy (nagłówek sidebara) ─────────────────────────────── */
function GeneralTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("company_name").maybeSingle();
      setCompanyName(((data as { company_name?: string | null } | null)?.company_name ?? "").trim());
      setLoading(false);
    })();
  }, [supabase]);

  async function save() {
    if (saving) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("app_settings")
      .upsert({ owner: user.id, company_name: companyName.trim() || null }, { onConflict: "owner" });
    setSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać — uruchom migration_attio_redesign.sql (kolumna company_name).");
    } else {
      toast.success("Zapisano. Nazwa firmy w sidebarze odświeży się po przeładowaniu.");
    }
  }

  return (
    <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 18, maxWidth: 520 }}>
      <label style={{ display: "grid", gap: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Nazwa firmy</span>
        <span style={{ fontSize: 12, color: tokens.muted }}>
          Wyświetlana w nagłówku sidebara obok logo.
        </span>
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Selltic"
          disabled={loading}
          style={{ ...inputStyle, maxWidth: 320 }}
        />
      </label>
      <div style={{ marginTop: 12 }}>
        <button onClick={save} disabled={saving || loading} style={primaryButton}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </section>
  );
}

/* ── Właściwości — JEDNA globalna lista definicji z zakresami ──────────────
   Pokazuje wszystkie właściwości: wbudowane/systemowe (zablokowane — bez
   usuwania i zmiany typu/klucza) ORAZ własne (w pełni edytowalne). Każda ma
   zakres (multi-select): "Deals", "Prospekty" — zakres decyduje, gdzie
   właściwość jest widoczna (kolumny, filtry, panele). */

type ScopeValue = "deals" | "prospects";
const SCOPE_LABEL: Record<ScopeValue, string> = { deals: "Deals", prospects: "Prospekty" };

// Wbudowane kolumny tabel prezentowane jako zablokowane właściwości systemowe.
const BUILTIN_PROPS: { key: string; label: string; typeLabel: string; scopes: ScopeValue[] }[] = [
  { key: "name", label: "Nazwa", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "company", label: "Firma", typeLabel: "tekst", scopes: ["deals"] },
  { key: "email", label: "E-mail", typeLabel: "e-mail", scopes: ["deals"] },
  { key: "phone", label: "Telefon", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "stage", label: "Etap lejka", typeLabel: "lista", scopes: ["deals"] },
  { key: "value", label: "Wartość", typeLabel: "liczba", scopes: ["deals"] },
  { key: "assignee", label: "Deal Owner", typeLabel: "lista", scopes: ["deals"] },
  { key: "source", label: "Źródło (techniczne)", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "website", label: "Strona WWW", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "address", label: "Adres", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "rating", label: "Ocena Google", typeLabel: "liczba", scopes: ["deals", "prospects"] },
  { key: "review_count", label: "Liczba opinii", typeLabel: "liczba", scopes: ["deals", "prospects"] },
  { key: "city", label: "Miasto", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "industry", label: "Branża", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "business_status", label: "Status firmy", typeLabel: "tekst", scopes: ["deals", "prospects"] },
  { key: "prospecting_status", label: "Status prospektu", typeLabel: "lista", scopes: ["prospects"] },
  { key: "lead_score", label: "Lead score", typeLabel: "liczba", scopes: ["deals", "prospects"] },
  { key: "contact_attempts", label: "Próby kontaktu", typeLabel: "liczba", scopes: ["prospects"] },
  { key: "opened_at", label: "Data otwarcia", typeLabel: "data", scopes: ["deals"] },
  { key: "created_at", label: "Data utworzenia", typeLabel: "data", scopes: ["deals", "prospects"] },
];

// Multi-select zakresu (dropdown z checkboxami) — wspólny dla wszystkich wierszy.
function ScopeSelect({
  value,
  onChange,
  locked = false,
}: {
  value: ScopeValue[];
  onChange?: (next: ScopeValue[]) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const label = value.length === 0 ? "— brak —" : value.map((v) => SCOPE_LABEL[v]).join(" + ");

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => !locked && setOpen((v) => !v)}
        title={locked ? "Zakres właściwości wbudowanej jest stały" : "Zmień zakres (gdzie właściwość jest widoczna)"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 9px",
          borderRadius: 6,
          border: `1px solid ${tokens.border}`,
          background: locked ? tokens.bg : "#fff",
          color: locked ? tokens.muted : tokens.text,
          fontSize: 12,
          fontWeight: 500,
          cursor: locked ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {!locked && <MIcon name="expand_more" size={13} />}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            boxShadow: tokens.shadowMenu,
            padding: 6,
            minWidth: 150,
          }}
        >
          {(Object.keys(SCOPE_LABEL) as ScopeValue[]).map((k) => {
            const on = value.includes(k);
            return (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = on ? value.filter((x) => x !== k) : [...value, k];
                    onChange?.(next);
                  }}
                  style={{ accentColor: tokens.accent, cursor: "pointer" }}
                />
                {SCOPE_LABEL[k]}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Oznaczenie właściwości systemowej: kłódka + badge.
function SystemBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 5, background: tokens.bg, color: tokens.muted, border: `1px solid ${tokens.border}`, flexShrink: 0 }}>
      <MIcon name="lock" size={11} /> Systemowa
    </span>
  );
}

function PropertiesTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [sysScopes, setSysScopes] = useState<Record<string, ScopeValue[]>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [newScopes, setNewScopes] = useState<ScopeValue[]>(["deals", "prospects"]);
  const [newOptions, setNewOptions] = useState<PropertyOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [showBuiltin, setShowBuiltin] = useState(false);

  // Tylko aktywne definicje (zarchiwizowane chowamy z listy). Dodatkowo:
  // dosiewamy definicję „Źródło kontaktu" (deals), jeśli jeszcze nie istnieje.
  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await ensureContactSourceDef(supabase, user.id);
    const [{ data }, settingsRes] = await Promise.all([
      supabase.from("property_defs").select("*").is("archived_at", null).order("position", { ascending: true }),
      supabase.from("app_settings").select("system_prop_scopes").maybeSingle(),
    ]);
    setDefs((data as PropertyDef[]) ?? []);
    const raw = (settingsRes.data as { system_prop_scopes?: Record<string, ScopeValue[]> | null } | null)?.system_prop_scopes;
    setSysScopes(raw && typeof raw === "object" ? raw : {});
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addDef(e?: React.FormEvent) {
    e?.preventDefault();
    const label = name.trim();
    if (!label || adding) return;
    setAdding(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAdding(false);
      return;
    }
    // Unikalny, stabilny klucz ze slugu nazwy (props jsonb trzyma ten klucz).
    const existing = new Set(defs.map((d) => d.key));
    let key = slugify(label);
    if (existing.has(key)) key = `${key}_${Math.random().toString(36).slice(2, 5)}`;
    const position = defs.length ? Math.max(...defs.map((d) => d.position)) + 1 : 0;
    const base = { owner: user.id, key, label, type, position, options: hasOptions(type) ? newOptions : null };
    let { data, error } = await supabase
      .from("property_defs")
      .insert({ ...base, scopes: newScopes })
      .select()
      .single();
    if (error && /scopes/.test(error.message)) {
      // Przed migration_attio_redesign.sql — dodaj bez zakresu (obie encje).
      ({ data, error } = await supabase.from("property_defs").insert(base).select().single());
      if (!error) toast.info("Zakres nie zapisał się na stałe — uruchom migration_attio_redesign.sql.");
    }
    if (!error && data) {
      setDefs((list) => [...list, data as PropertyDef]);
      setName("");
      setType("text");
      setNewScopes(["deals", "prospects"]);
      setNewOptions([]);
      toast.success("Właściwość dodana.");
    } else if (error) {
      toast.error("Nie udało się dodać właściwości (czy nazwa nie jest zajęta?).");
    }
    setAdding(false);
  }

  async function patchDef(id: string, patch: Partial<PropertyDef>) {
    const snapshot = defs;
    setDefs((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    const { error } = await supabase.from("property_defs").update(patch).eq("id", id);
    if (error) {
      if ("scopes" in patch && /scopes/.test(error.message)) {
        toast.error("Zakresy wymagają migracji — uruchom migration_attio_redesign.sql (Supabase → SQL Editor).");
        return;
      }
      setDefs(snapshot);
      toast.error("Nie udało się zapisać zmian.");
    }
  }

  // Zakres właściwości systemowych (Kategoria / Cel kontaktu) — nadpisanie w
  // app_settings.system_prop_scopes.
  async function patchSystemScopes(key: string, scopes: ScopeValue[]) {
    const next = { ...sysScopes, [key]: scopes };
    setSysScopes(next);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ owner: user.id, system_prop_scopes: next }, { onConflict: "owner" });
    if (error) {
      toast.error("Zakresy właściwości systemowych wymagają migracji — uruchom migration_attio_redesign.sql.");
    }
  }

  // Miękkie usunięcie — dane w props zostają, właściwość znika z list/filtrów.
  async function archiveDef(def: PropertyDef) {
    if (!window.confirm(`Zarchiwizować właściwość „${propLabel(def)}"?\n\nDane leadów NIE zostaną usunięte — właściwość zniknie tylko z kolumn, filtrów i panelu leada.`)) return;
    const snapshot = defs;
    setDefs((list) => list.filter((d) => d.id !== def.id));
    const { error } = await supabase.from("property_defs").update({ archived_at: new Date().toISOString() }).eq("id", def.id);
    if (error) {
      setDefs(snapshot);
      toast.error("Nie udało się zarchiwizować właściwości.");
    } else {
      toast.success("Właściwość zarchiwizowana.");
    }
  }

  function persistOrder(next: PropertyDef[]) {
    setDefs(next);
    Promise.all(next.map((d, i) => supabase.from("property_defs").update({ position: i }).eq("id", d.id)));
  }

  const scopesOf = (d: PropertyDef): ScopeValue[] => {
    const raw = d.scopes;
    if (!Array.isArray(raw) || raw.length === 0) return ["deals", "prospects"];
    return raw.filter((x): x is ScopeValue => x === "deals" || x === "prospects");
  };

  return (
    <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 18 }}>
      <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 16px" }}>
        Jedna lista WSZYSTKICH właściwości — systemowych i własnych. Zakres („Deals" / „Prospekty")
        decyduje, gdzie właściwość jest widoczna: kolumny list, filtry, panele rekordów.
        Właściwości systemowe są zablokowane (bez usuwania i zmiany typu).
      </p>

      {/* ── Systemowe z edytowalnymi opcjami (Kategoria / Cel kontaktu) ── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: tokens.muted, textTransform: "uppercase", margin: "0 0 8px" }}>
        Systemowe
      </div>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        <SystemPropertyCard
          title="Kategoria"
          typeLabel={TYPE_LABEL.select}
          table="lead_categories"
          scopes={sysScopes["category"] ?? ["deals", "prospects"]}
          onScopesChange={(next) => patchSystemScopes("category", next)}
        />
        <SystemPropertyCard
          title="Cel kontaktu"
          typeLabel={TYPE_LABEL.multi_select}
          table="contact_purposes"
          scopes={sysScopes["purposes"] ?? ["deals", "prospects"]}
          onScopesChange={(next) => patchSystemScopes("purposes", next)}
        />
      </div>

      {/* ── Wbudowane pola rekordów (zablokowane, zakres stały) ── */}
      <button
        onClick={() => setShowBuiltin((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer", padding: "4px 0", fontSize: 12.5, fontWeight: 600, color: tokens.muted, marginBottom: 8 }}
      >
        <MIcon name={showBuiltin ? "expand_more" : "chevron_right"} size={15} />
        Wbudowane pola rekordów ({BUILTIN_PROPS.length})
      </button>
      {showBuiltin && (
        <div style={{ display: "grid", gap: 4, marginBottom: 16 }}>
          {BUILTIN_PROPS.map((b) => (
            <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", border: `1px solid ${tokens.borderSoft}`, borderRadius: 8, background: "#FCFCFD" }}>
              <MIcon name="lock" size={13} color={tokens.muted} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
              <span style={{ fontSize: 11.5, color: tokens.muted, flexShrink: 0 }}>{b.typeLabel}</span>
              <ScopeSelect value={b.scopes} locked />
              <SystemBadge />
            </div>
          ))}
        </div>
      )}

      {/* ── Właściwości użytkownika ── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: tokens.muted, textTransform: "uppercase", margin: "14px 0 8px" }}>
        Twoje właściwości
      </div>
      {loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : defs.length === 0 ? (
        <p style={{ color: tokens.muted, fontSize: 13, margin: "0 0 16px" }}>Brak własnych właściwości.</p>
      ) : (
        <Reorder.Group axis="y" values={defs} onReorder={persistOrder} style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gap: 6 }}>
          {defs.map((d) => (
            <UserPropertyRow key={d.id} def={d} scopes={scopesOf(d)} onPatch={patchDef} onArchive={archiveDef} />
          ))}
        </Reorder.Group>
      )}

      {/* ── Dodaj właściwość ── */}
      <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, paddingTop: 14 }}>
        <form onSubmit={addDef} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="Nazwa właściwości" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, flex: "2 1 180px" }} />
            <select value={type} onChange={(e) => setType(e.target.value as PropertyType)} style={{ ...inputStyle, flex: "1 1 150px" }}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <ScopeSelect value={newScopes} onChange={setNewScopes} />
            <button type="submit" disabled={adding} style={primaryButton}>
              <MIcon name="add" size={15} /> Dodaj
            </button>
          </div>
          {hasOptions(type) && (
            <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.muted, marginBottom: 8 }}>Opcje listy</div>
              <OptionsEditor options={newOptions} onChange={setNewOptions} />
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

// Wiersz właściwości użytkownika: nazwa, typ (zmiana z potwierdzeniem), zakres,
// edytor opcji dla list, archiwizacja. Przeciągalny (zmiana kolejności).
function UserPropertyRow({
  def,
  scopes,
  onPatch,
  onArchive,
}: {
  def: PropertyDef;
  scopes: ScopeValue[];
  onPatch: (id: string, patch: Partial<PropertyDef>) => void;
  onArchive: (def: PropertyDef) => void;
}) {
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(false);
  const [labelDraft, setLabelDraft] = useState(propLabel(def));
  const options = useMemo(() => normalizeOptions(def.options), [def.options]);

  function changeType(next: PropertyType) {
    if (next === def.type) return;
    if (!window.confirm(`Zmienić typ właściwości „${propLabel(def)}" z „${TYPE_LABEL[def.type]}" na „${TYPE_LABEL[next]}"?\n\nIstniejące wartości leadów nie zostaną skasowane, ale mogą być inaczej interpretowane/wyświetlane.`)) return;
    onPatch(def.id, { type: next, options: hasOptions(next) ? options : null });
  }

  return (
    <Reorder.Item value={def} dragListener={false} dragControls={controls} style={{ listStyle: "none", border: `1px solid ${tokens.border}`, borderRadius: 8, background: tokens.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px" }}>
        <button onPointerDown={(e) => controls.start(e)} aria-label="Przeciągnij" style={{ border: "none", background: "none", cursor: "grab", padding: 0, color: tokens.muted, touchAction: "none", flexShrink: 0 }}>
          <MIcon name="drag_indicator" size={15} />
        </button>
        <input
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            const v = labelDraft.trim();
            if (v && v !== propLabel(def)) onPatch(def.id, { label: v });
            else setLabelDraft(propLabel(def));
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 500, padding: "4px 8px" }}
        />
        <select value={def.type} onChange={(e) => changeType(e.target.value as PropertyType)} style={{ ...inputStyle, width: 160, padding: "4px 8px", flexShrink: 0 }}>
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <ScopeSelect value={scopes} onChange={(next) => onPatch(def.id, { scopes: next })} />
        {hasOptions(def.type) && (
          <button onClick={() => setExpanded((s) => !s)} title="Opcje listy" style={{ ...iconBtn }}>
            <MIcon name={expanded ? "expand_more" : "chevron_right"} size={15} />
          </button>
        )}
        <button onClick={() => onArchive(def)} title="Archiwizuj" aria-label="Archiwizuj właściwość" style={{ ...iconBtn }}>
          <MIcon name="archive" size={15} color={tokens.muted} />
        </button>
      </div>
      {hasOptions(def.type) && expanded && (
        <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, padding: 12 }}>
          <OptionsEditor options={options} onChange={(next) => onPatch(def.id, { options: next })} />
        </div>
      )}
    </Reorder.Item>
  );
}

// Właściwość systemowa (Kategoria / Cel kontaktu) — dane w dedykowanej tabeli
// (lead_categories / contact_purposes). Edytor opcji zapisuje wprost do tabeli;
// zakres (gdzie widoczna) można zawęzić.
function SystemPropertyCard({
  title,
  typeLabel,
  table,
  scopes,
  onScopesChange,
}: {
  title: string;
  typeLabel: string;
  table: "lead_categories" | "contact_purposes";
  scopes: ScopeValue[];
  onScopesChange: (next: ScopeValue[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { reload } = useClassification();
  const [rows, setRows] = useState<{ id: string; key: string; label: string; color: string; position: number }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from(table).select("id, key, label, color, position").order("position", { ascending: true });
    setRows((data as typeof rows) ?? []);
    setLoaded(true);
  }, [supabase, table]);

  useEffect(() => {
    if (expanded && !loaded) load();
  }, [expanded, loaded, load]);

  const options = useMemo<PropertyOption[]>(() => rows.map((r) => ({ key: r.key, label: r.label, color: r.color })), [rows]);

  async function addOption(label: string, color: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const existing = new Set(rows.map((r) => r.key));
    let key = slugify(label);
    if (existing.has(key)) key = `${key}_${Math.random().toString(36).slice(2, 5)}`;
    const position = rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
    const { data, error } = await supabase.from(table).insert({ owner: user.id, key, label, color, position }).select("id, key, label, color, position").single();
    if (!error && data) {
      setRows((r) => [...r, data as (typeof rows)[number]]);
      reload();
    } else {
      toast.error("Nie udało się dodać opcji.");
    }
  }

  async function editOption(key: string, patch: { label?: string; color?: string }) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const { error } = await supabase.from(table).update(patch).eq("id", row.id);
    if (error) toast.error("Nie udało się zapisać opcji.");
    else reload();
  }

  async function removeOption(key: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    if (!window.confirm(`Usunąć opcję „${row.label}"? Leady, które ją miały, pokażą „—".`)) return;
    setRows((list) => list.filter((r) => r.key !== key));
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) toast.error("Nie udało się usunąć opcji.");
    else reload();
  }

  async function reorder(keys: string[]) {
    const next = keys.map((k) => rows.find((r) => r.key === k)!).filter(Boolean);
    setRows(next.map((r, i) => ({ ...r, position: i })));
    await Promise.all(next.map((r, i) => supabase.from(table).update({ position: i }).eq("id", r.id)));
    reload();
  }

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 8, background: tokens.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px" }}>
        <MIcon name="lock" size={13} color={tokens.muted} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 11.5, color: tokens.muted, flexShrink: 0 }}>{typeLabel}</span>
        <ScopeSelect value={scopes} onChange={onScopesChange} />
        <SystemBadge />
        <button onClick={() => setExpanded((s) => !s)} title="Opcje listy" style={{ ...iconBtn }}>
          <MIcon name={expanded ? "expand_more" : "chevron_right"} size={15} />
        </button>
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${tokens.borderSoft}`, padding: 12 }}>
          {!loaded ? (
            <p style={{ fontSize: 13, color: tokens.muted, margin: 0 }}>Wczytywanie…</p>
          ) : (
            <OptionsEditor
              options={options}
              onAdd={addOption}
              onEdit={editOption}
              onRemove={removeOption}
              onReorderKeys={reorder}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Edytor opcji listy — dwa tryby:
//  • lokalny (property_defs): przekaż `onChange(next)`; edytor trzyma stan.
//  • tabelaryczny (systemowe): przekaż `onAdd/onEdit/onRemove/onReorderKeys`,
//    które zapisują wprost do bazy.
function OptionsEditor({
  options,
  onChange,
  onAdd,
  onEdit,
  onRemove,
  onReorderKeys,
}: {
  options: PropertyOption[];
  onChange?: (next: PropertyOption[]) => void;
  onAdd?: (label: string, color: string) => void;
  onEdit?: (key: string, patch: { label?: string; color?: string }) => void;
  onRemove?: (key: string) => void;
  onReorderKeys?: (keys: string[]) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6C5CE7");

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    if (onAdd) onAdd(label, newColor);
    else if (onChange) {
      const existing = new Set(options.map((o) => o.key));
      let key = slugify(label);
      if (existing.has(key)) key = `${key}_${Math.random().toString(36).slice(2, 5)}`;
      onChange([...options, { key, label, color: newColor }]);
    }
    setNewLabel("");
  }

  function edit(key: string, patch: { label?: string; color?: string }) {
    if (onEdit) onEdit(key, patch);
    else if (onChange) onChange(options.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function remove(key: string) {
    if (onRemove) onRemove(key);
    else if (onChange) onChange(options.filter((o) => o.key !== key));
  }

  function reorder(next: PropertyOption[]) {
    if (onReorderKeys) onReorderKeys(next.map((o) => o.key));
    else if (onChange) onChange(next);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {options.length === 0 && <p style={{ fontSize: 12.5, color: tokens.muted, margin: 0 }}>Brak opcji — dodaj pierwszą poniżej.</p>}
      <Reorder.Group axis="y" values={options} onReorder={reorder} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {options.map((o) => (
          <OptionRow key={o.key} option={o} onEdit={edit} onRemove={remove} />
        ))}
      </Reorder.Group>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ width: 34, height: 34, padding: 0, border: `1px solid ${tokens.border}`, borderRadius: 8, cursor: "pointer", flexShrink: 0 }} />
        <input
          placeholder="Nowa opcja…"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          style={{ ...inputStyle, flex: 1, padding: "7px 10px" }}
        />
        <button type="button" onClick={add} style={{ ...ghostButton, padding: "7px 12px", display: "flex", alignItems: "center", gap: 5 }}>
          <MIcon name="add" size={15} /> Dodaj
        </button>
      </div>
    </div>
  );
}

function OptionRow({ option, onEdit, onRemove }: { option: PropertyOption; onEdit: (key: string, patch: { label?: string; color?: string }) => void; onRemove: (key: string) => void }) {
  const controls = useDragControls();
  const [label, setLabel] = useState(option.label);
  useEffect(() => setLabel(option.label), [option.label]);
  return (
    <Reorder.Item value={option} dragListener={false} dragControls={controls} style={{ listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
      <button onPointerDown={(e) => controls.start(e)} aria-label="Przeciągnij" style={{ border: "none", background: "none", cursor: "grab", padding: 0, color: tokens.muted, touchAction: "none", flexShrink: 0 }}>
        <MIcon name="drag_indicator" size={14} />
      </button>
      <input type="color" value={option.color ?? "#6C5CE7"} onChange={(e) => onEdit(option.key, { color: e.target.value })} style={{ width: 30, height: 30, padding: 0, border: `1px solid ${tokens.border}`, borderRadius: 7, cursor: "pointer", flexShrink: 0 }} />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const v = label.trim();
          if (v && v !== option.label) onEdit(option.key, { label: v });
          else setLabel(option.label);
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "6px 10px" }}
      />
      <button onClick={() => onRemove(option.key)} aria-label="Usuń opcję" style={{ ...iconBtn }}>
        <MIcon name="delete" size={14} color={tokens.muted} />
      </button>
    </Reorder.Item>
  );
}

const iconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

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

/* ── Integracje → Wysyłka e-mail (Resend) — item 9 ───────────────────────
   Klucz API trzymany server-side (app_settings), czytany tylko przez backend
   (/api/submit, /api/email/test). GET nie zwraca klucza — jedynie informację,
   czy jest ustawiony. Zapis i test idą przez dedykowane API. */
function IntegrationsTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [from, setFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // Trwały komunikat pod przyciskiem „Zapisz” (obok ulotnego toastu), żeby po
  // zapisie ZAWSZE było widać jednoznaczne potwierdzenie sukcesu lub błędu.
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/email");
    if (res.ok) {
      const body = await res.json();
      setConfigured(!!body.configured);
      setFrom(body.from || "");
      setReplyTo(body.replyTo || "");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) setTestTo(user.email);
      try {
        await refresh();
      } catch {
        /* offline — pozostaw pola puste */
      }
      setLoading(false);
    })();
  }, [supabase, refresh]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey || undefined, from, replyTo }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        const msg = b?.error || "Nie udało się zapisać.";
        setStatus({ kind: "err", msg });
        toast.error(msg);
      } else {
        setApiKey("");
        // Odczytaj z powrotem z bazy, aby POTWIERDZIĆ, że zapis faktycznie się utrwalił.
        await refresh().catch(() => {});
        setStatus({ kind: "ok", msg: "Zapisano ✓ — ustawienia e-mail są utrwalone w bazie." });
        toast.success("Zapisano ustawienia e-mail.");
      }
    } catch {
      setStatus({ kind: "err", msg: "Błąd sieci przy zapisie." });
      toast.error("Błąd sieci przy zapisie.");
    }
    setSaving(false);
  }

  async function clearKey() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      if (res.ok) {
        setConfigured(false);
        setApiKey("");
        setStatus({ kind: "ok", msg: "Klucz usunięty." });
        toast.success("Klucz usunięty.");
      } else {
        const b = await res.json().catch(() => null);
        setStatus({ kind: "err", msg: b?.error || "Nie udało się usunąć klucza." });
      }
    } catch {
      setStatus({ kind: "err", msg: "Błąd sieci." });
      toast.error("Błąd sieci.");
    }
    setSaving(false);
  }

  // Test połączenia (item 9): wysyła testowy e-mail używając klucza wpisanego
  // (jeśli podano) lub zapisanego, na wskazany adres.
  async function testConnection() {
    const to = testTo.trim();
    if (!to) {
      toast.error("Podaj adres, na który wysłać test.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, apiKey: apiKey || undefined, from: from || undefined }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) toast.error(b?.error || "Test nie powiódł się.");
      else toast.success("Test wysłany — sprawdź skrzynkę.");
    } catch {
      toast.error("Błąd sieci przy teście.");
    }
    setTesting(false);
  }

  if (loading) {
    return (
      <Section>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </Section>
    );
  }

  // Dokąd trafią ODPOWIEDZI: jeśli podano reply-to → tam; inaczej na adres nadawcy.
  const replyDestination = replyTo.trim() || senderEmail(from) || "adres nadawcy";

  return (
    <Section>
      <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 16px", lineHeight: 1.6 }}>
        Wszystkie maile z systemu — automatyczne „dziękujemy”, powiadomienia o leadach oraz wiadomości
        wysyłane ręcznie z karty leada (szablony) — wychodzą przez{" "}
        <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: tokens.accent }}>
          Resend
        </a>
        . Klucz jest przechowywany po stronie serwera i nigdy nie wraca do przeglądarki.
      </p>

      <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Klucz API Resend {configured && <span style={{ color: tokens.success, fontWeight: 600 }}>· zapisany ✓</span>}
          </span>
          <input
            type="password"
            placeholder={configured ? "•••••••••• (zostaw puste, aby nie zmieniać)" : "re_..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={inputStyle}
          />
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Klucz uwierzytelnia wysyłkę w Resend. Wygenerujesz go w panelu Resend →{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              style={{ color: tokens.accent }}
            >
              API Keys
            </a>{" "}
            (zaczyna się od <code>re_</code>). Bez niego żaden e-mail nie zostanie wysłany.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Adres nadawcy (FROM)</span>
          <input
            placeholder="Zespół Selltic <kontakt@twoja-domena.pl>"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={inputStyle}
          />
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            To adres, z którego <b>wychodzą</b> wszystkie automatyczne wiadomości (widoczny u odbiorcy jako
            nadawca). Domena (część po <code>@</code>) <b>musi być zweryfikowana w Resend</b> (SPF/DKIM) →{" "}
            <a href="https://resend.com/domains" target="_blank" rel="noreferrer" style={{ color: tokens.accent }}>
              Domains
            </a>
            . Format: <code>Nazwa &lt;adres@domena.pl&gt;</code>.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Adres do odpowiedzi (Reply-To)</span>
          <input
            type="email"
            placeholder="np. biuro@gmail.com (opcjonalnie)"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            style={inputStyle}
          />
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Gdy odbiorca kliknie „Odpowiedz”, wiadomość trafi tutaj. Ustaw np. swojego Gmaila, mimo że
            maile wychodzą z domeny. Pole opcjonalne — jeśli je zostawisz puste, odpowiedzi pójdą na adres
            nadawcy.
            <br />
            <span style={{ color: tokens.text, fontWeight: 600 }}>Odpowiedzi trafią do: {replyDestination}</span>
          </span>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={save} disabled={saving} style={primaryButton}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </button>
          {configured && (
            <button onClick={clearKey} disabled={saving} style={{ ...ghostButton, color: tokens.danger }}>
              Usuń klucz
            </button>
          )}
        </div>

        {status && (
          <div
            role="status"
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${status.kind === "ok" ? tokens.success : tokens.danger}`,
              background: status.kind === "ok" ? "rgba(24,169,87,0.08)" : "rgba(229,72,77,0.08)",
              color: status.kind === "ok" ? tokens.success : tokens.danger,
            }}
          >
            {status.msg}
          </div>
        )}

        <div style={{ height: 1, background: tokens.border }} />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Test połączenia</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="email"
              placeholder="adres@do-testu.pl"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 200px", minWidth: 0 }}
            />
            <button onClick={testConnection} disabled={testing} style={{ ...ghostButton, whiteSpace: "nowrap" }}>
              {testing ? "Wysyłanie…" : "Wyślij test"}
            </button>
          </div>
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Wysyła przykładowy e-mail na adres wpisany powyżej, korzystając z podanego (lub zapisanego)
            klucza i adresu nadawcy. Jeśli dojdzie — klucz i domena są poprawnie skonfigurowane. Jeśli nie —
            zobaczysz konkretny błąd zwrócony przez Resend.
          </span>
        </label>
      </div>
    </Section>
  );
}

// Wyciąga sam adres e-mail z pola nadawcy w formacie „Nazwa <adres@domena>”.
function senderEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/* ── Bramka SMS (SMSAPI) ──────────────────────────────────────────────────
   Token i sekret DLR trzymane po stronie serwera (app_settings), czytane przez
   /api/sms/* z fallbackiem do ENV. GET nigdy nie zwraca sekretów — tylko czy są
   ustawione. Wzorzec jak IntegrationsTab (Resend). */
function SmsGatewayTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [dlrConfigured, setDlrConfigured] = useState(false);
  const [token, setToken] = useState("");
  const [sender, setSender] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [dlrSecret, setDlrSecret] = useState("");
  const [testTo, setTestTo] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/sms");
    if (res.ok) {
      const b = await res.json();
      setTokenConfigured(!!b.tokenConfigured);
      setDlrConfigured(!!b.dlrConfigured);
      setSender(b.sender || "");
      setBaseUrl(b.baseUrl || "");
      setTestMode(!!b.testMode);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch {
        /* offline */
      }
      setLoading(false);
    })();
  }, [refresh]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token || undefined,
          sender,
          baseUrl,
          testMode,
          dlrSecret: dlrSecret || undefined,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        const msg = b?.error || "Nie udało się zapisać.";
        setStatus({ kind: "err", msg });
        toast.error(msg);
      } else {
        setToken("");
        setDlrSecret("");
        await refresh().catch(() => {});
        setStatus({ kind: "ok", msg: "Zapisano ✓ — konfiguracja bramki SMS utrwalona w bazie." });
        toast.success("Zapisano ustawienia SMS.");
      }
    } catch {
      setStatus({ kind: "err", msg: "Błąd sieci przy zapisie." });
      toast.error("Błąd sieci przy zapisie.");
    }
    setSaving(false);
  }

  async function clearSecret(which: "token" | "dlr") {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(which === "token" ? { clearToken: true } : { clearDlr: true }),
      });
      if (res.ok) {
        if (which === "token") setTokenConfigured(false);
        else setDlrConfigured(false);
        toast.success(which === "token" ? "Token usunięty." : "Sekret DLR usunięty.");
      } else toast.error("Nie udało się usunąć.");
    } catch {
      toast.error("Błąd sieci.");
    }
    setSaving(false);
  }

  async function sendTest() {
    const to = testTo.trim();
    if (!to) {
      toast.error("Podaj numer, na który wysłać test.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, body: "Test SMS z Selltic — konfiguracja bramki dziala." }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) toast.error(b?.error || "Test nie powiódł się.");
      else toast.success(testMode ? "Test zwalidowany (tryb testowy — nie dostarczono)." : "Test wysłany — sprawdź telefon.");
    } catch {
      toast.error("Błąd sieci przy teście.");
    }
    setTesting(false);
  }

  function generateDlrSecret() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setDlrSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
  }

  if (loading) {
    return (
      <Section>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </Section>
    );
  }

  return (
    <Section>
      <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 16px", lineHeight: 1.6 }}>
        Wszystkie SMS-y — potwierdzenia z formularzy, przypomnienia o spotkaniach i wiadomości ręczne z karty
        leada — wychodzą przez{" "}
        <a href="https://www.smsapi.pl" target="_blank" rel="noreferrer" style={{ color: tokens.accent }}>
          SMSAPI
        </a>
        . Token jest przechowywany po stronie serwera i nigdy nie wraca do przeglądarki. Wartości ustawione tu
        mają pierwszeństwo przed zmiennymi środowiskowymi.
      </p>

      <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Token API {tokenConfigured && <span style={{ color: tokens.success, fontWeight: 600 }}>· zapisany ✓</span>}
          </span>
          <input
            type="password"
            placeholder={tokenConfigured ? "•••••••••• (zostaw puste, aby nie zmieniać)" : "token OAuth SMSAPI"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={inputStyle}
          />
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Wygenerujesz go w panelu SMSAPI → <b>API → Tokeny API → Wygeneruj token dostępu</b>. Bez niego
            żaden SMS nie zostanie wysłany.
          </span>
        </label>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6, flex: "1 1 200px", minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Nazwa nadawcy</span>
            <input placeholder="np. Selltic" value={sender} onChange={(e) => setSender(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.5 }}>
              Musi być zatwierdzona w SMSAPI (Pola nadawcy).
            </span>
          </label>
          <label style={{ display: "grid", gap: 6, flex: "1 1 200px", minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Adres API (opcjonalnie)</span>
            <input placeholder="https://api.smsapi.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.5 }}>
              Zostaw puste dla domyślnego.
            </span>
          </label>
        </div>

        <ToggleRow
          label="Tryb testowy"
          desc="Wiadomości są walidowane, ale NIE wysyłane i NIE zużywają kredytów. Włącz na czas konfiguracji."
          checked={testMode}
          onChange={setTestMode}
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Sekret webhooka DLR {dlrConfigured && <span style={{ color: tokens.success, fontWeight: 600 }}>· zapisany ✓</span>}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="password"
              placeholder={dlrConfigured ? "•••••••••• (zostaw puste, aby nie zmieniać)" : "długi losowy ciąg"}
              value={dlrSecret}
              onChange={(e) => setDlrSecret(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 220px", minWidth: 0 }}
            />
            <button onClick={generateDlrSecret} style={{ ...ghostButton, whiteSpace: "nowrap" }}>
              Wygeneruj
            </button>
          </div>
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Chroni endpoint raportów doręczeń (SMSAPI nie podpisuje callbacków). W panelu SMSAPI ustaw URL
            powiadomień na: <code>{"{adres-aplikacji}"}/api/sms/dlr?token={"{ten-sekret}"}</code>.
          </span>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={save} disabled={saving} style={primaryButton}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </button>
          {tokenConfigured && (
            <button onClick={() => clearSecret("token")} disabled={saving} style={{ ...ghostButton, color: tokens.danger }}>
              Usuń token
            </button>
          )}
          {dlrConfigured && (
            <button onClick={() => clearSecret("dlr")} disabled={saving} style={{ ...ghostButton, color: tokens.danger }}>
              Usuń sekret DLR
            </button>
          )}
        </div>

        {status && (
          <div
            role="status"
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${status.kind === "ok" ? tokens.success : tokens.danger}`,
              background: status.kind === "ok" ? "rgba(24,169,87,0.08)" : "rgba(229,72,77,0.08)",
              color: status.kind === "ok" ? tokens.success : tokens.danger,
            }}
          >
            {status.msg}
          </div>
        )}

        <div style={{ height: 1, background: tokens.border }} />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Test połączenia</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="+48601234567"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 200px", minWidth: 0 }}
            />
            <button onClick={sendTest} disabled={testing} style={{ ...ghostButton, whiteSpace: "nowrap" }}>
              {testing ? "Wysyłanie…" : "Wyślij test"}
            </button>
          </div>
          <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.55 }}>
            Wysyła krótki SMS na podany numer, korzystając z zapisanej konfiguracji. Zapisz ustawienia przed
            testem. Przy włączonym trybie testowym nic nie zostanie dostarczone.
          </span>
        </label>
      </div>
    </Section>
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
              <MIcon name="delete" size={13} color={tokens.muted} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} style={{ ...ghostButton, marginTop: 8, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }}>
        <MIcon name="add" size={14} /> Dodaj regułę
      </button>
    </div>
  );
}
