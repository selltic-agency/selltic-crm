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
// czysta funkcja, żeby dało się ją przetestować (to tu żył błąd: odświeżenie
// z filtrem NIE przywracało zakładki/sortowania). Kluczowa subtelność:
// `hasUrlFilters` jest prawdziwe zarówno przy zwykłym odświeżeniu (FilterBar
// sam zapisuje filtry do URL), jak i przy udostępnionym linku — dlatego NIE
// może blokować przywracania zakładki statusu / sortowania / aktywnego widoku,
// których w URL nie ma. Steruje jedynie źródłem filtrów.
export type HydrationPlan = {
  /** Przywróć zakładkę statusu / sortowanie / aktywny widok z prefs. */
  restoreFromPrefs: boolean;
  /** Wywołaj filterBar.setFilters(prefs.filters) — tylko gdy URL ich nie niesie. */
  restoreFiltersFromPrefs: boolean;
  /** Wyczyść aktywny widok (udostępniony link bez własnych prefs). */
  clearActiveView: boolean;
  /** Zastosuj domyślny (aktywny) zapisany widok — pierwsza wizyta bez prefs. */
  applyDefaultView: boolean;
};

export function planHydration(prefs: ViewPrefs | null, hasUrlFilters: boolean): HydrationPlan {
  if (prefs) {
    return {
      restoreFromPrefs: true,
      restoreFiltersFromPrefs: !hasUrlFilters && Array.isArray(prefs.filters),
      clearActiveView: false,
      applyDefaultView: false,
    };
  }
  return {
    restoreFromPrefs: false,
    restoreFiltersFromPrefs: false,
    clearActiveView: hasUrlFilters,
    applyDefaultView: !hasUrlFilters,
  };
}
