// lib/filters.ts — pomocnik do budowania zapytań Supabase na podstawie filtrów (8.4).


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

// Faza 9.4: lejek odpytuje tabelę `leads` ze złączonym (inner) `contacts`.
// Pola leada filtrujemy bezpośrednio; pola kontaktu przez prefiks `contacts.`;
// właściwości własne kontaktu przez `contacts.props->>klucz`.
const LEAD_FIELDS = new Set(["stage", "value", "source", "opened_at", "created_at"]);
const CONTACT_FIELDS = new Set(["name", "email", "phone", "company"]);

function columnFor(field: string): string {
  if (LEAD_FIELDS.has(field)) return field;
  if (CONTACT_FIELDS.has(field)) return `contacts.${field}`;
  return `contacts.props->>${field}`;
}

/**
 * Aplikuje tablicę filtrów do zapytania Supabase.
 * Filtry łączone są operatorem AND (domyślne zachowanie Supabase .filter()).
 */
export function buildFilterQuery(
  query: any,
  filters: Filter[]
) {
  let q = query;

  filters.forEach((f) => {
    const column = columnFor(f.field);

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
