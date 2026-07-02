// lib/viewPrefs.test.ts — weryfikacja trwałości stanu widoku (zadanie 6c).
// Uruchom: npx tsx lib/viewPrefs.test.ts
import assert from "node:assert";
import { loadViewPrefs, saveViewPrefs, planHydration, type ViewPrefs } from "./viewPrefs";

// Minimalny mock localStorage + window dla środowiska Node.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, `FAIL: ${name}`);
  passed++;
}

// ── 1. Round-trip: to co zapisano, to się wczytuje (per-user, per-page) ──
const prefs: ViewPrefs = {
  activeViewId: "view-123",
  statusFilter: "no_answer",
  filters: [{ field: "lead_score", operator: "gt", value: 69 }],
  sort: { column: "created_at", direction: "asc" },
};
saveViewPrefs("prospecting", "user-A", prefs);
const back = loadViewPrefs("prospecting", "user-A");
ok("round-trip zwraca ten sam obiekt", JSON.stringify(back) === JSON.stringify(prefs));

// ── 2. Izolacja per-user i per-page ──
ok("inny user nie widzi cudzych prefs", loadViewPrefs("prospecting", "user-B") === null);
ok("inna strona nie widzi prefs", loadViewPrefs("deals", "user-A") === null);

// ── 3. Brak prefs → null (nie rzuca) ──
ok("brak wpisu → null", loadViewPrefs("prospecting", "nieznany") === null);

// ── 4. planHydration: ODŚWIEŻENIE PO NAŁOŻENIU FILTRU (rdzeń błędu z 6c) ──
// Po nałożeniu filtru FilterBar zapisuje go do URL, więc po odświeżeniu
// hasUrlFilters === true. MIMO to zakładka/sort/aktywny widok muszą się
// przywrócić z prefs (URL ich nie niesie); filtry odtwarza sam FilterBar z URL.
const planReload = planHydration(prefs, /* hasUrlFilters */ true);
ok("reload z filtrem: przywraca zakładkę/sort/widok z prefs", planReload.restoreFromPrefs === true);
ok("reload z filtrem: NIE nadpisuje filtrów z prefs (URL wygrywa)", planReload.restoreFiltersFromPrefs === false);

// ── 5. planHydration: nawigacja wstecz (bez ?f w URL) → pełne przywrócenie ──
const planNav = planHydration(prefs, /* hasUrlFilters */ false);
ok("nawigacja wstecz: przywraca stan z prefs", planNav.restoreFromPrefs === true);
ok("nawigacja wstecz: odtwarza też filtry z prefs", planNav.restoreFiltersFromPrefs === true);

// ── 6. planHydration: pierwsza wizyta bez prefs ──
const planFirst = planHydration(null, false);
ok("pierwsza wizyta: stosuje domyślny widok", planFirst.applyDefaultView === true && planFirst.restoreFromPrefs === false);

// ── 7. planHydration: udostępniony link bez prefs → czyści aktywny widok ──
const planShared = planHydration(null, true);
ok("udostępniony link bez prefs: czyści aktywny widok", planShared.clearActiveView === true && planShared.applyDefaultView === false);

console.log(`✓ Wszystkie ${passed} asercji przeszły — trwałość stanu widoku działa.`);
