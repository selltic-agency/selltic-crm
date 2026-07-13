// lib/viewPrefs.ts — trwały stan widoku (per użytkownik, per strona), zapisany
// w localStorage. Rozwiązuje problem, w którym po odświeżeniu / przejściu na inną
// zakładkę i powrocie tracono: aktywną zakładkę (zapisany widok), wybraną
// zakładkę statusu, filtry, sortowanie i tryb widoku.
//
// Dlaczego localStorage, a nie baza: hydratacja jest synchroniczna (brak
// migotania stanu domyślnego, brak wyścigu z ładowaniem zapisanych widoków),
// a odczyt jest niezawodny przy odświeżeniu ORAZ nawigacji w obrębie SPA.
// Klucz jest namespace'owany po ID użytkownika, więc stan jest per-user nawet
// przy współdzielonej przeglądarce.
"use client";

import type { Filter, Sort } from "@/lib/filters";

export type ViewMode = "kanban" | "table";

export type ViewPrefs = {
  activeViewId?: string | null;
  statusFilter?: string;
  filters?: Filter[];
  sort?: Sort | null;
  viewMode?: ViewMode;
};

function keyFor(page: string, userId: string | null): string {
  return `selltic_view_prefs::${page}::${userId ?? "anon"}`;
}

export function loadViewPrefs(page: string, userId: string | null): ViewPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(page, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ViewPrefs) : null;
  } catch {
    return null;
  }
}

export function saveViewPrefs(page: string, userId: string | null, prefs: ViewPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(page, userId), JSON.stringify(prefs));
  } catch {
    /* quota / tryb prywatny — best-effort, brak zapisu nie może wywalić UI */
  }
}

// Decyzja hydratacji stanu widoku przy wczytaniu strony — wyodrębniona jako
// czysta funkcja, żeby dało się ją przetestować.
//
// Zmiana zachowania (Part 2 / zakładki-przeglądarki): stan początkowy strony to
// ZAWSZE „Wszystkie" (brak aktywnego widoku, brak filtrów). Żaden zapisany widok
// ani filtr nie jest pre-selekcjonowany na wejściu — użytkownik sam wybiera, co
// zastosować. Z prefs przywracamy WYŁĄCZNIE preferencje prezentacji (tryb widoku
// kanban/tabela oraz sortowanie), które nie są „filtrem". Filtry z udostępnionego
// linku (?f=…) odtwarza samodzielnie FilterBar i pojawiają się jako filtr
// tymczasowy (ad-hoc), nie jako zapisany widok.
export type HydrationPlan = {
  /** Przywróć preferencje prezentacji (viewMode / sort) z prefs. */
  restoreDisplayFromPrefs: boolean;
};

export function planHydration(prefs: ViewPrefs | null): HydrationPlan {
  return { restoreDisplayFromPrefs: !!prefs };
}
