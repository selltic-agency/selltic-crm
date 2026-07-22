// components/FilterBar.tsx — definicje pól filtrowalnych (typy współdzielone).
// Dawny pełnowymiarowy pasek filtrów (chipy + panel edycji) został zastąpiony
// kompaktowym popoverem components/views/FilterButton.tsx (Attio-style);
// tu zostały wyłącznie typy, z których korzysta reszta aplikacji.
import type { PropertyType } from "@/lib/types";

export type FieldOption = string | { key: string; label: string };

export type FieldDef = {
  key: string;
  label: string;
  // „tags” = kolumna-tablica (np. prospects.purposes) — multi-select z
  // operatorem has_any (nakładanie się zbiorów).
  type: PropertyType | "stage" | "source" | "value" | "date" | "select" | "tags";
  options?: FieldOption[];
};
