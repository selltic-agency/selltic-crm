// lib/types.ts — współdzielone typy TypeScript (CRM + formularze).

export type StageId = "new" | "contact" | "offer" | "won" | "lost";

export interface Stage {
  id: StageId;
  label: string;
  color: string;
}

// Pięć etapów lejka — kolejność = kolumny na tablicy kanban.
export const STAGES: Stage[] = [
  { id: "new", label: "Nowy lead", color: "#6C5CE7" },
  { id: "contact", label: "Kontakt", color: "#1A73E7" },
  { id: "offer", label: "Oferta", color: "#F2994A" },
  { id: "won", label: "Wygrane", color: "#18A957" },
  { id: "lost", label: "Przegrane", color: "#8A92A6" },
];

export function stageById(id: string): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

export interface Contact {
  id: string;
  owner: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: StageId;
  value: number;
  source: string | null;
  form_id: string | null;
  props: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type ActivityType = "note" | "call" | "email" | "submission" | "stage";

export interface Activity {
  id: string;
  owner: string;
  contact_id: string;
  type: ActivityType;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface Task {
  id: string;
  owner: string;
  contact_id: string | null;
  title: string;
  due_at: string | null;
  done: boolean;
  created_at: string;
}

export type PropertyType = "text" | "number" | "date" | "select";

export interface PropertyDef {
  id: string;
  owner: string;
  key: string;
  type: PropertyType;
  options: string[] | null;
  position: number;
}
