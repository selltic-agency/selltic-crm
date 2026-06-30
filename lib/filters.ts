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

// Pola wbudowane w tabelę 'contacts'.
const BUILT_IN_FIELDS = [
  "stage",
  "source",
  "value",
  "created_at",
  "name",
  "email",
  "phone",
  "company",
];

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
    const isBuiltIn = BUILT_IN_FIELDS.includes(f.field);
    // Dla pól własnych używamy operatora ->>, który wyciąga wartość jako tekst.
    const column = isBuiltIn ? f.field : `props->>${f.field}`;

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
