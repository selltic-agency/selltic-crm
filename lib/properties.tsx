// lib/properties.tsx — uogólniony system WŁAŚCIWOŚCI leadów (custom fields).
//
// Model HYBRYDOWY: „Kategoria" i „Cel kontaktu" pozostają w dedykowanych
// kolumnach/tabelach, ale są prezentowane jako WBUDOWANE właściwości systemowe
// (obok właściwości definiowanych przez użytkownika w property_defs). Dzięki
// temu cała reszta UI (kolumny, filtry, panel szczegółów, akcje zbiorcze) widzi
// jeden spójny typ `PropertyView`, niezależnie od tego gdzie fizycznie żyje
// wartość.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useClassification } from "@/lib/classification";
import type { PropertyDef, PropertyOption, PropertyType } from "@/lib/types";
import type { FieldDef } from "@/components/FilterBar";

export type EntityKind = "deals" | "prospects";

// Ujednolicony obraz właściwości używany w całym UI.
export type PropertyView = {
  key: string; // klucz kolumny (systemowe) albo klucz w props jsonb (własne)
  label: string;
  type: PropertyType;
  options: PropertyOption[]; // znormalizowane; puste dla typów bez listy
  system: boolean; // true → kategoria/cel kontaktu (kolumna/tabela dedykowana)
  storage: "column" | "props"; // gdzie żyje wartość
  archived: boolean;
};

// Klucze właściwości systemowych — pokrywają się z nazwami kolumn, więc filtry
// (buildFilterQuery) trafiają w rzeczywiste kolumny bez dodatkowego mapowania.
export const SYS_CATEGORY = "category";
export const SYS_PURPOSES = "purposes";

export const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "text", label: "tekst" },
  { value: "number", label: "liczba" },
  { value: "date", label: "data" },
  { value: "select", label: "lista (jednokrotny wybór)" },
  { value: "multi_select", label: "lista (wielokrotny wybór)" },
  { value: "boolean", label: "tak / nie" },
  { value: "email", label: "e-mail" },
];

export const TYPE_LABEL: Record<PropertyType, string> = {
  text: "tekst",
  number: "liczba",
  date: "data",
  select: "lista",
  multi_select: "lista (wiele)",
  boolean: "tak / nie",
  email: "e-mail",
};

export const BOOL_YES = "true";
export const BOOL_NO = "false";

// Zamień options (string[] LUB PropertyOption[]) na spójny PropertyOption[].
export function normalizeOptions(options: PropertyDef["options"]): PropertyOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    typeof o === "string" ? { key: o, label: o } : { key: o.key, label: o.label ?? o.key, color: o.color }
  );
}

export function propLabel(def: Pick<PropertyDef, "key" | "label">): string {
  return (def.label && def.label.trim()) || def.key;
}

export function hasOptions(type: PropertyType): boolean {
  return type === "select" || type === "multi_select";
}

// slug z etykiety — do generowania stabilnego `key` opcji przy dodawaniu.
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `opt_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Odczyt / zapis wartości właściwości na rekordzie ──────────────────────
type AnyRecord = Record<string, unknown> & { props?: Record<string, unknown> | null };

export function readPropValue(record: AnyRecord, view: PropertyView): unknown {
  if (view.storage === "column") return record[view.key];
  return record.props?.[view.key];
}

// Znormalizuj wartość multi-select do string[].
export function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

// Resolver kolumn dla buildFilterQuery: właściwości własne (storage 'props')
// mapujemy na ścieżkę jsonb — multi_select na `props->klucz` (tablica jsonb, do
// operatora has_any), pozostałe na `props->>klucz` (tekst). Kolumny wbudowane i
// systemowe (kategoria/cel) zwracamy bezpośrednio.
export function makeColumnResolver(views: PropertyView[]): (field: string) => string {
  const byKey = new Map(views.map((v) => [v.key, v]));
  return (field: string) => {
    const v = byKey.get(field);
    if (v && v.storage === "props") {
      return v.type === "multi_select" ? `props->${field}` : `props->>${field}`;
    }
    return field;
  };
}

// ── Mapowanie na FieldDef dla FilterBar ───────────────────────────────────
export function toFieldDef(view: PropertyView): FieldDef {
  if (view.type === "multi_select") {
    return { key: view.key, label: view.label, type: "tags", options: view.options.map((o) => ({ key: o.key, label: o.label })) };
  }
  if (view.type === "select") {
    return { key: view.key, label: view.label, type: "select", options: view.options.map((o) => ({ key: o.key, label: o.label })) };
  }
  if (view.type === "boolean") {
    return {
      key: view.key,
      label: view.label,
      type: "select",
      options: [
        { key: BOOL_YES, label: "Tak" },
        { key: BOOL_NO, label: "Nie" },
      ],
    };
  }
  if (view.type === "number") return { key: view.key, label: view.label, type: "number" };
  if (view.type === "date") return { key: view.key, label: view.label, type: "date" };
  return { key: view.key, label: view.label, type: "text" };
}

// ── Akcja zbiorcza: ustaw wartość właściwości dla wielu rekextrów ──────────
// Obsługuje właściwości kolumnowe (systemowe) i jsonb (własne). Dla multi_select
// `mode` decyduje: 'replace' nadpisuje, 'add' dokłada (suma bez duplikatów).
type SupabaseLike = ReturnType<typeof createClient>;
const BULK_CHUNK = 100;

function chunk<T>(arr: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function applyBulkProperty(
  supabase: SupabaseLike,
  table: EntityKind,
  ids: string[],
  view: PropertyView,
  value: unknown,
  mode: "replace" | "add" = "replace"
): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };

  try {
    if (view.storage === "column") {
      if (view.type === "multi_select") {
        const incoming = asArray(value);
        if (mode === "add") {
          // Dokładanie: przeczytaj bieżące zbiory i połącz bez duplikatów.
          for (const part of chunk(ids)) {
            const { data } = await supabase.from(table).select(`id, ${view.key}`).in("id", part);
            const rows = (data as Record<string, unknown>[] | null) ?? [];
            await Promise.all(
              rows.map((r) => {
                const cur = asArray(r[view.key]);
                const next = [...new Set([...cur, ...incoming])];
                return supabase.from(table).update({ [view.key]: next }).eq("id", r.id as string);
              })
            );
          }
        } else {
          for (const part of chunk(ids)) {
            const { error } = await supabase.from(table).update({ [view.key]: incoming }).in("id", part);
            if (error) return { error: error.message };
          }
        }
      } else {
        // Kolumna skalarna (np. kategoria) — nadpisujemy.
        const v = value === "" || value === undefined ? null : value;
        for (const part of chunk(ids)) {
          const { error } = await supabase.from(table).update({ [view.key]: v }).in("id", part);
          if (error) return { error: error.message };
        }
      }
      return { error: null };
    }

    // Właściwość własna → wartość w props jsonb (merge per rekord).
    for (const part of chunk(ids)) {
      const { data } = await supabase.from(table).select("id, props").in("id", part);
      const rows = (data as { id: string; props: Record<string, unknown> | null }[] | null) ?? [];
      await Promise.all(
        rows.map((r) => {
          const props = { ...(r.props ?? {}) };
          if (view.type === "multi_select") {
            const incoming = asArray(value);
            props[view.key] = mode === "add" ? [...new Set([...asArray(props[view.key]), ...incoming])] : incoming;
            if ((props[view.key] as string[]).length === 0) delete props[view.key];
          } else {
            const empty = value == null || value === "";
            if (empty) delete props[view.key];
            else props[view.key] = value;
          }
          return supabase.from(table).update({ props }).eq("id", r.id);
        })
      );
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Nieznany błąd" };
  }
}

// Dopisuje historię „celu kontaktu" (append-only) po zbiorczej edycji w trybie
// „dołóż". Tabela historii i kolumna FK zależą od encji: deals→deal_purposes/
// deal_id, prospects→prospect_purposes/prospect_id. Wspólne dla Leadów i
// Prospectingu (wcześniej ten sam blok był skopiowany w obu stronach).
// Historia jest wtórna wobec samego zapisu właściwości — błąd tu logujemy,
// ale nie przerywamy przepływu (spójnie z resztą kodu).
export async function appendPurposeHistory(
  supabase: SupabaseLike,
  entity: EntityKind,
  ids: string[],
  purposes: string[]
): Promise<void> {
  if (ids.length === 0 || purposes.length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const table = entity === "deals" ? "deal_purposes" : "prospect_purposes";
  const idField = entity === "deals" ? "deal_id" : "prospect_id";
  const rows = ids.flatMap((id) =>
    purposes.map((purpose) => ({ owner: user.id, [idField]: id, purpose, source: "bulk" }))
  );
  const { error } = await supabase.from(table).insert(rows);
  if (error) console.error(`Nie zapisano historii celu kontaktu (${table}):`, error);
}

// ── Zakresy właściwości (gdzie właściwość jest widoczna) ──────────────────
// Definicja bez kolumny scopes (przed migration_attio_redesign.sql) = obie encje.
export function defScopes(def: Pick<PropertyDef, "scopes">): EntityKind[] {
  const raw = def.scopes;
  if (!Array.isArray(raw) || raw.length === 0) return ["deals", "prospects"];
  return raw.filter((s): s is EntityKind => s === "deals" || s === "prospects");
}

export function defInScope(def: Pick<PropertyDef, "scopes">, entity: EntityKind): boolean {
  return defScopes(def).includes(entity);
}

// Nadpisania zakresów właściwości SYSTEMOWYCH (kategoria / cel kontaktu) —
// app_settings.system_prop_scopes = { category: ['deals','prospects'], ... }.
export type SystemPropScopes = Record<string, EntityKind[]>;

// ── Hook: właściwości dla encji (systemowe + własne, wg zakresów) ─────────
export function useEntityProperties(entity: EntityKind) {
  const supabase = useMemo(() => createClient(), []);
  const { categories, purposes } = useClassification();
  const [defs, setDefs] = useState<PropertyDef[]>([]);
  const [sysScopes, setSysScopes] = useState<SystemPropScopes>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    // Tylko aktywne (niearchiwalne) właściwości trafiają do UI list/filtrów.
    const [{ data }, settingsRes] = await Promise.all([
      supabase.from("property_defs").select("*").is("archived_at", null).order("position", { ascending: true }),
      supabase.from("app_settings").select("system_prop_scopes").maybeSingle(),
    ]);
    setDefs((data as PropertyDef[]) ?? []);
    const raw = (settingsRes.data as { system_prop_scopes?: SystemPropScopes | null } | null)?.system_prop_scopes;
    setSysScopes(raw && typeof raw === "object" ? raw : {});
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Właściwości systemowe: kategoria (single-select) + cel kontaktu (multi).
  // Zakres można zawęzić w Ustawieniach (system_prop_scopes); domyślnie obie encje.
  const systemViews = useMemo<PropertyView[]>(() => {
    const inScope = (key: string) => {
      const s = sysScopes[key];
      return !Array.isArray(s) || s.length === 0 ? true : s.includes(entity);
    };
    const all: PropertyView[] = [
      {
        key: SYS_CATEGORY,
        label: "Kategoria",
        type: "select",
        options: categories.map((c) => ({ key: c.key, label: c.label, color: c.color })),
        system: true,
        storage: "column",
        archived: false,
      },
      {
        key: SYS_PURPOSES,
        label: "Cel kontaktu",
        type: "multi_select",
        options: purposes.map((p) => ({ key: p.key, label: p.label, color: p.color })),
        system: true,
        storage: "column",
        archived: false,
      },
    ];
    return all.filter((v) => inScope(v.key));
  }, [categories, purposes, sysScopes, entity]);

  const customViews = useMemo<PropertyView[]>(() => {
    return defs
      .filter((d) => defInScope(d, entity))
      .map((d) => ({
        key: d.key,
        label: propLabel(d),
        type: d.type,
        options: normalizeOptions(d.options),
        system: false,
        storage: "props" as const,
        archived: !!d.archived_at,
      }));
  }, [defs, entity]);

  const views = useMemo(() => [...systemViews, ...customViews], [systemViews, customViews]);

  return { views, systemViews, customViews, defs, loading, reload };
}
