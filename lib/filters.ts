// lib/filters.ts — pomocnik do budowania zapytań Supabase na podstawie filtrów (8.4).
// Współdzielony przez Leady (deals) i Prospecting (prospects) — każda strona
// dostarcza własny resolver kolumn, bo tylko deals ma properties w `props` jsonb.

export type FilterOperator =
  | "contains"
  | "equals"
  | "is_empty"
  | "gt"
  | "lt"
  | "between"
  | "before"
  | "after"
  | "last_n_days"
  | "in";

export type Filter = {
  field: string;
  operator: FilterOperator;
  value: any;
};

export type Sort = {
  column: string;
  direction: "asc" | "desc";
};

// Faza 10: deal to samodzielny rekord (tożsamość + szansa sprzedaży w
// jednej tabeli) — pola filtrujemy bezpośrednio, bez prefiksu join'a.
const DEAL_FIELDS = new Set(["stage", "value", "source", "opened_at", "created_at", "name", "email", "phone", "company", "assignee"]);

function columnForDeal(field: string): string {
  if (DEAL_FIELDS.has(field)) return field;
  return `props->>${field}`;
}

// Prospekty nie mają definicji właściwości własnych (property_defs) — każde
// filtrowalne pole żyje bezpośrednio jako kolumna tabeli `prospects`.
export function columnForProspect(field: string): string {
  return field;
}

/**
 * Aplikuje tablicę filtrów do zapytania Supabase.
 * Filtry łączone są operatorem AND (domyślne zachowanie Supabase .filter()).
 * `resolveColumn` mapuje klucz pola filtru na nazwę kolumny/ścieżki jsonb —
 * domyślnie zachowanie sprzed refaktoru (deale + props->>).
 */
export function buildFilterQuery(
  query: any,
  filters: Filter[],
  resolveColumn: (field: string) => string = columnForDeal
) {
  let q = query;

  filters.forEach((f) => {
    const column = resolveColumn(f.field);

    switch (f.operator) {
      case "contains":
        if (f.value) q = q.ilike(column, `%${f.value}%`);
        break;

      case "equals":
        q = q.eq(column, f.value);
        break;

      case "is_empty":
        // Dla JSONB sprawdzamy czy klucz jest nullem.
        q = q.is(column, null);
        break;

      case "gt":
      case "after":
        if (f.value !== undefined && f.value !== "") q = q.gt(column, f.value);
        break;

      case "lt":
      case "before":
        if (f.value !== undefined && f.value !== "") q = q.lt(column, f.value);
        break;

      case "between":
        if (Array.isArray(f.value) && f.value.length === 2) {
          if (f.value[0] !== undefined && f.value[0] !== "") q = q.gte(column, f.value[0]);
          if (f.value[1] !== undefined && f.value[1] !== "") q = q.lte(column, f.value[1]);
        }
        break;

      case "last_n_days": {
        const days = parseInt(f.value);
        if (!isNaN(days)) {
          const date = new Date();
          date.setDate(date.getDate() - days);
          q = q.gte(column, date.toISOString());
        }
        break;
      }

      case "in":
        if (Array.isArray(f.value) && f.value.length > 0) {
          q = q.in(column, f.value);
        }
        break;
    }
  });

  return q;
}
