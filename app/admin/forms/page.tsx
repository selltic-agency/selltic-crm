// app/admin/forms/page.tsx — lista formularzy w stylu zakładki Leady:
// sortowalna tabela z KONFIGUROWALNYMI kolumnami (Ustawienia widoku), spójna
// kolorystyka i gęstość. Zamiast „Archiwum" mamy „Kosz" (osobna karta obok
// „Aktywne", na wzór filtrów w Leadach) z akcjami Przywróć / Usuń trwale.
// Globalna lista zgłoszeń przeniesiona do osobnej zakładki /admin/submissions.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, primaryButton, formatRelative, formatDateTime, pageTitle, menuPanel } from "@/lib/ui";
import { blankForm, randomSlug } from "@/lib/forms";
import type { ColumnPref } from "@/lib/savedViews";
import ShareModal from "./share-modal";
import { useToast } from "@/components/Toast";
import MIcon from "@/components/MaterialIcon";
import EmptyState from "@/components/EmptyState";
import ViewSettingsButton from "@/components/views/ViewSettingsButton";

// Poniżej tej szerokości dostępnego obszaru tabela zwija się do listy kart.
const TABLE_MIN_WIDTH = 900;

// Trwałe preferencje kolumn (per przeglądarka) — lista formularzy nie ma
// zapisanych widoków, więc układ kolumn trzymamy w localStorage.
const COLUMNS_KEY = "selltic_forms_columns";

type MetricsRow = {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  views: number;
  unique_users: number;
  completions: number;
  abandoned: number;
  last_submission: string | null;
  conversion_rate: number | null;
};

type SortKey = "title" | "status" | "created_at" | "views" | "unique_users" | "completions" | "abandoned" | "conversion_rate" | "last_submission";
type Sort = { key: SortKey; dir: "asc" | "desc" };

// Słownik kolumn konfigurowalnych (kolumna „Nazwa" jest przypięta i zawsze
// pierwsza — nie ma jej w tej liście). `num` = wyrównanie do prawej.
const COLUMN_DEFS: { key: SortKey; label: string; num?: boolean; width?: number }[] = [
  { key: "status", label: "Status" },
  { key: "created_at", label: "Data utworzenia" },
  { key: "views", label: "Wyświetlenia", num: true },
  { key: "unique_users", label: "Unikalni", num: true },
  { key: "completions", label: "Zgłoszenia", num: true },
  { key: "abandoned", label: "Porzucone", num: true },
  { key: "conversion_rate", label: "Konwersja", num: true, width: 140 },
  { key: "last_submission", label: "Ostatnie zgłoszenie" },
];
const COLUMN_LABELS: Record<string, string> = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.label]));
const DEFAULT_VISIBLE = new Set<string>(["status", "views", "completions", "conversion_rate", "last_submission"]);

function defaultColumnPrefs(): ColumnPref[] {
  return COLUMN_DEFS.map((c, i) => ({ key: c.key, visible: DEFAULT_VISIBLE.has(c.key), position: i }));
}

function loadColumnPrefs(): ColumnPref[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMNS_KEY);
    return raw ? (JSON.parse(raw) as ColumnPref[]) : null;
  } catch {
    return null;
  }
}

export default function FormsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();

  const listRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setCompact(w < TABLE_MIN_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [rows, setRows] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [sort, setSort] = useState<Sort>({ key: "created_at", dir: "desc" });
  const [shareForm, setShareForm] = useState<{ slug: string; title: string } | null>(null);

  // ── Konfiguracja kolumn (localStorage) ──────────────────────────────────
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[] | null>(null);
  useEffect(() => setColumnPrefs(loadColumnPrefs()), []);
  const fullColumnPrefs = useMemo<ColumnPref[]>(() => {
    const base = columnPrefs ?? defaultColumnPrefs();
    const known = new Set(base.map((c) => c.key));
    const missing = COLUMN_DEFS.filter((c) => !known.has(c.key)).map((c, i) => ({ key: c.key, visible: false, position: base.length + i }));
    return [...base, ...missing].filter((c) => COLUMN_LABELS[c.key]).sort((a, b) => a.position - b.position);
  }, [columnPrefs]);
  const changeColumns = useCallback((next: ColumnPref[]) => {
    setColumnPrefs(next);
    try { window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  }, []);
  const visibleColumns = useMemo(
    () => fullColumnPrefs.filter((c) => c.visible).map((c) => COLUMN_DEFS.find((d) => d.key === c.key)!),
    [fullColumnPrefs]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("form_metrics")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      const { data: forms } = await supabase
        .from("forms")
        .select("id, title, slug, status, archived_at, created_at")
        .order("created_at", { ascending: false });
      setRows(((forms as MetricsRow[]) ?? []).map((f) => ({
        ...f, views: 0, unique_users: 0, completions: 0, abandoned: 0, last_submission: null, conversion_rate: null,
      })));
    } else {
      setRows((data as MetricsRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => (tab === "trash" ? !!r.archived_at : !r.archived_at)),
    [rows, tab]
  );

  const sorted = useMemo(() => {
    const val = (r: MetricsRow): string | number => {
      switch (sort.key) {
        case "title": return (r.title || "").toLowerCase();
        case "status": return statusRank(r);
        case "created_at": return r.created_at ? new Date(r.created_at).getTime() : 0;
        case "last_submission": return r.last_submission ? new Date(r.last_submission).getTime() : 0;
        case "conversion_rate": return r.conversion_rate ?? -1;
        default: return r[sort.key] ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === bv) return 0;
      const res = av > bv ? 1 : -1;
      return sort.dir === "asc" ? res : -res;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  async function newForm() {
    if (creating) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCreating(false); return; }
    const schema = blankForm();
    const { data, error } = await supabase
      .from("forms")
      .insert({ owner: user.id, title: schema.title, slug: randomSlug(), schema, status: "draft" })
      .select("id").single();
    setCreating(false);
    if (!error && data) router.push(`/admin/forms/${data.id}`);
  }

  async function duplicate(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: src } = await supabase.from("forms").select("title, schema").eq("id", id).single();
    if (!src) return;
    const { error } = await supabase.from("forms").insert({
      owner: user.id, title: `${src.title} (kopia)`, slug: randomSlug(), schema: src.schema, status: "draft",
    });
    if (!error) { toast.success("Zduplikowano formularz"); load(); }
  }

  async function archive(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    setRows((list) => list.map((r) => (r.id === id ? { ...r, archived_at: new Date().toISOString() } : r)));
    const { error } = await supabase.from("forms").update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null }).eq("id", id);
    if (error) { toast.error("Nie udało się przenieść do kosza"); load(); }
    else toast.success("Przeniesiono do kosza");
  }

  async function restore(id: string) {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, archived_at: null } : r)));
    const { error } = await supabase.from("forms").update({ archived_at: null, archived_by: null }).eq("id", id);
    if (error) { toast.error("Nie udało się przywrócić"); load(); }
    else toast.success("Formularz przywrócony");
  }

  async function destroy(id: string) {
    if (!window.confirm("Usunąć formularz trwale? Tej operacji nie można cofnąć.")) return;
    setRows((list) => list.filter((r) => r.id !== id));
    const { error } = await supabase.from("forms").delete().eq("id", id);
    if (error) { toast.error("Nie udało się usunąć formularza"); load(); }
    else toast.success("Formularz usunięty trwale");
  }

  function copyLink(slug: string | null) {
    if (!slug) return;
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard?.writeText(url).then(() => toast.success("Skopiowano link"));
  }

  const activeCount = rows.filter((r) => !r.archived_at).length;
  const trashCount = rows.filter((r) => r.archived_at).length;

  return (
    <div ref={listRef}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>Formularze</h1>
        <button onClick={newForm} disabled={creating} style={primaryButton}>
          <MIcon name="add" size={15} />
          {creating ? "Tworzenie…" : "Nowy formularz"}
        </button>
      </div>

      {/* Toolbar w stylu Leadów: segment Aktywne/Kosz + Ustawienia widoku */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", background: tokens.bg, border: `1px solid ${tokens.border}`, padding: 2, borderRadius: tokens.radiusSm, gap: 2 }}>
          <SegBtn icon="description" label="Aktywne" count={activeCount} active={tab === "active"} onClick={() => setTab("active")} />
          <SegBtn icon="delete" label="Kosz" count={trashCount} active={tab === "trash"} onClick={() => setTab("trash")} />
        </div>
        <div style={{ flex: 1 }} />
        <ViewSettingsButton
          viewMode="table"
          columns={fullColumnPrefs}
          columnLabels={COLUMN_LABELS}
          onColumnsChange={changeColumns}
        />
      </div>

      {loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : sorted.length === 0 ? (
        <FormsEmptyState tab={tab} onNew={newForm} />
      ) : compact ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((r) => (
            <MobileCard
              key={r.id}
              r={r}
              onOpen={() => router.push(`/admin/forms/${r.id}`)}
              onStats={() => router.push(`/admin/forms/${r.id}?tab=stats`)}
              onShare={() => r.slug && setShareForm({ slug: r.slug, title: r.title })}
              onCopy={() => copyLink(r.slug)}
              onDuplicate={() => duplicate(r.id)}
              onArchive={() => archive(r.id)}
              onRestore={() => restore(r.id)}
              onDestroy={() => destroy(r.id)}
              onSubmissions={() => router.push(`/admin/forms/${r.id}?tab=submissions`)}
            />
          ))}
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "visible" }}>
          <div style={{ overflow: "visible" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                  <SortHeader label="Nazwa" k="title" sort={sort} onSort={toggleSort} />
                  {visibleColumns.map((c) => (
                    <SortHeader key={c.key} label={c.label} k={c.key} sort={sort} onSort={toggleSort} num={c.num} />
                  ))}
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    columns={visibleColumns}
                    onOpen={() => router.push(`/admin/forms/${r.id}`)}
                    onStats={() => router.push(`/admin/forms/${r.id}?tab=stats`)}
                    onShare={() => r.slug && setShareForm({ slug: r.slug, title: r.title })}
                    onCopy={() => copyLink(r.slug)}
                    onDuplicate={() => duplicate(r.id)}
                    onArchive={() => archive(r.id)}
                    onRestore={() => restore(r.id)}
                    onDestroy={() => destroy(r.id)}
                    onSubmissions={() => router.push(`/admin/forms/${r.id}?tab=submissions`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {shareForm?.slug && (
        <ShareModal slug={shareForm.slug} title={shareForm.title} onClose={() => setShareForm(null)} />
      )}
    </div>
  );
}

function SegBtn({ icon, label, count, active, onClick }: { icon: string; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6,
        border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500,
        background: active ? tokens.card : "transparent", color: active ? tokens.text : tokens.muted,
        boxShadow: active ? "0 1px 2px rgba(15,18,28,0.08)" : "none", transition: "all .15s ease",
      }}
    >
      <MIcon name={icon} size={15} color={active ? tokens.accent : tokens.muted} />
      {label}
      <span style={{ fontSize: 11, fontWeight: 500, color: tokens.muted, background: tokens.bg, borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>{count}</span>
    </button>
  );
}

function statusRank(r: MetricsRow): number {
  if (r.archived_at) return 2;
  return r.status === "published" ? 1 : 0;
}

function StatusBadge({ r }: { r: MetricsRow }) {
  const archived = !!r.archived_at;
  const published = r.status === "published";
  const label = archived ? "Kosz" : published ? "Opublikowany" : "Szkic";
  const bg = archived ? tokens.bg : published ? "#E7F7EE" : tokens.bg;
  const color = archived ? tokens.muted : published ? tokens.success : tokens.muted;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: bg, color }}>
      {label}
    </span>
  );
}

function numCell(value: number, hasViews: boolean): React.ReactNode {
  if (!hasViews) return <span style={{ color: tokens.muted }}>—</span>;
  return value.toLocaleString("pl-PL");
}

// Render pojedynczej komórki wg klucza kolumny.
function cellContent(r: MetricsRow, key: SortKey): React.ReactNode {
  const hasViews = r.views > 0;
  switch (key) {
    case "status": return <StatusBadge r={r} />;
    case "created_at": return r.created_at ? formatDateTime(r.created_at) : <span style={{ color: tokens.muted }}>—</span>;
    case "views": return numCell(r.views, hasViews);
    case "unique_users": return numCell(r.unique_users, hasViews);
    case "completions": return numCell(r.completions, hasViews);
    case "abandoned": return numCell(r.abandoned, hasViews);
    case "conversion_rate":
      return hasViews && r.conversion_rate != null ? <ConversionBar pct={r.conversion_rate} /> : <span style={{ color: tokens.muted }}>—</span>;
    case "last_submission":
      return r.last_submission ? formatRelative(r.last_submission) : <span style={{ color: tokens.muted }}>—</span>;
    default: return null;
  }
}

type RowActions = {
  onOpen: () => void; onStats: () => void; onShare: () => void; onCopy: () => void;
  onDuplicate: () => void; onArchive: () => void; onRestore: () => void; onDestroy: () => void; onSubmissions: () => void;
};

function Row({ r, columns, ...actions }: { r: MetricsRow; columns: { key: SortKey; num?: boolean }[] } & RowActions) {
  const archived = !!r.archived_at;
  const muted = archived ? { opacity: 0.6 } : {};

  return (
    <tr
      style={{ borderBottom: `1px solid ${tokens.border}`, ...muted }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={{ ...tdStyle, cursor: "pointer" }} onClick={actions.onOpen}>
        <div style={{ fontWeight: 600 }}>{r.title || "Bez tytułu"}</div>
        {r.slug && <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2 }}>/{r.slug}</div>}
      </td>
      {columns.map((c) => (
        <td key={c.key} style={{ ...tdStyle, textAlign: c.num ? "right" : "left" }}>{cellContent(r, c.key)}</td>
      ))}
      <td style={{ ...tdStyle, textAlign: "center", overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
        <RowMenu archived={archived} hasSlug={!!r.slug} slug={r.slug} {...actions} />
      </td>
    </tr>
  );
}

function MobileCard({ r, ...actions }: { r: MetricsRow } & RowActions) {
  const archived = !!r.archived_at;
  const hasViews = r.views > 0;

  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 14, ...(archived ? { opacity: 0.7 } : {}) }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={actions.onOpen}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Bez tytułu"}</div>
          {r.slug && <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>/{r.slug}</div>}
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <RowMenu archived={archived} hasSlug={!!r.slug} slug={r.slug} {...actions} />
        </div>
      </div>

      <div style={{ marginTop: 10 }}><StatusBadge r={r} /></div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
        <Metric label="Wyświetlenia" value={numCell(r.views, hasViews)} />
        <Metric label="Zgłoszenia" value={numCell(r.completions, hasViews)} />
        <Metric label="Konwersja" value={hasViews && r.conversion_rate != null ? `${r.conversion_rate.toFixed(1)}%` : <span style={{ color: tokens.muted }}>—</span>} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: tokens.muted }}>
        Ostatnie zgłoszenie: {r.last_submission ? formatRelative(r.last_submission) : "—"}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function ConversionBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
      <span style={{ width: 44, height: 6, borderRadius: 999, background: tokens.border, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${clamped}%`, background: tokens.accent }} />
      </span>
    </div>
  );
}

function RowMenu({
  archived, hasSlug, slug, onOpen, onStats, onShare, onCopy, onDuplicate, onArchive, onRestore, onDestroy, onSubmissions,
}: { archived: boolean; hasSlug: boolean; slug: string | null } & RowActions) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const item = (icon: React.ReactNode, label: string, action: () => void, danger = false) => (
    <button
      onClick={() => { setOpen(false); action(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "9px 12px", border: "none", background: "transparent", cursor: "pointer",
        fontSize: 13, color: danger ? tokens.danger : tokens.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon}{label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Więcej akcji"
        style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", color: tokens.muted }}
      >
        <MIcon name="more_horiz" size={16} />
      </button>
      {open && (
        <div style={{ ...menuPanel, position: "absolute", right: 0, top: 32, zIndex: 30, width: 210, padding: 4 }}>
          {archived ? (
            <>
              {item(<MIcon name="inbox" size={15} />, "Zobacz zgłoszenia", onSubmissions)}
              {item(<MIcon name="restore_from_trash" size={15} />, "Przywróć", onRestore)}
              {item(<MIcon name="delete_forever" size={15} />, "Usuń trwale", onDestroy, true)}
            </>
          ) : (
            <>
              {item(<MIcon name="edit" size={15} />, "Edytuj", onOpen)}
              {item(<MIcon name="inbox" size={15} />, "Zgłoszenia", onSubmissions)}
              {hasSlug && item(<MIcon name="link" size={15} />, "Kopiuj link", onCopy)}
              {hasSlug && item(<MIcon name="open_in_new" size={15} />, "Podgląd", () => slug && window.open(`/f/${slug}`, "_blank"))}
              {item(<MIcon name="content_copy" size={15} />, "Duplikuj", onDuplicate)}
              {item(<MIcon name="monitoring" size={15} />, "Statystyki", onStats)}
              {item(<MIcon name="delete" size={15} />, "Przenieś do kosza", onArchive, true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FormsEmptyState({ tab, onNew }: { tab: "active" | "trash"; onNew: () => void }) {
  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
      <EmptyState
        title={tab === "trash" ? "Kosz jest pusty" : "Brak formularzy"}
        description={
          tab === "trash"
            ? "Formularze przeniesione do kosza pojawią się tutaj. Możesz je przywrócić lub usunąć trwale."
            : "Utwórz pierwszy formularz, aby zbierać zgłoszenia."
        }
        action={tab === "active" ? { label: "Nowy formularz", icon: "add", onClick: onNew } : undefined}
      />
    </div>
  );
}

function SortHeader({ label, k, sort, onSort, num }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; num?: boolean }) {
  return (
    <th
      onClick={() => onSort(k)}
      style={{ textAlign: num ? "right" : "left", padding: "12px 16px", fontSize: 12, fontWeight: 700, color: tokens.muted, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: num ? "flex-end" : "flex-start" }}>
        {label.toUpperCase()}
        {sort.key === k && <MIcon name={sort.dir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />}
      </div>
    </th>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
  whiteSpace: "nowrap",
};
