// lib/types.ts — współdzielone typy domeny (CRM + formularze).

export type Stage = "new" | "contact" | "offer" | "won" | "lost";

export type ActivityType = "note" | "call" | "email" | "submission" | "stage" | "task";

export type PropertyType = "text" | "number" | "date" | "select";

export type Contact = {
  id: string;
  owner: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: Stage;
  value: number;
  source: string | null;
  form_id: string | null;
  props: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  id: string;
  owner: string;
  contact_id: string;
  type: ActivityType;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type Task = {
  id: string;
  owner: string;
  contact_id: string | null;
  title: string;
  due_at: string | null;
  done: boolean;
  created_at: string;
  // opcjonalna złączona nazwa kontaktu (z select ... contacts(name))
  contacts?: { id: string; name: string | null } | null;
};

export type PropertyDef = {
  id: string;
  owner: string;
  key: string;
  type: PropertyType;
  options: string[] | null;
  position: number;
};

export type AppSettings = {
  owner: string;
  email_new_lead: boolean;
  email_task_due: boolean;
  notify_email: string | null;
};

// Etykiety etapów lejka (kolejność = kolumny pipeline).
export const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "new", label: "Nowy lead", color: "#6C5CE7" },
  { key: "contact", label: "Kontakt", color: "#1A73E7" },
  { key: "offer", label: "Oferta", color: "#F2994A" },
  { key: "won", label: "Wygrane", color: "#18A957" },
  { key: "lost", label: "Przegrane", color: "#8A92A6" },
];

export function stageMeta(stage: Stage) {
  return STAGES.find((s) => s.key === stage) ?? STAGES[0];
}
