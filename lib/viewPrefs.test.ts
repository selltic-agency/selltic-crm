// lib/viewPrefs.test.ts — weryfikacja trwałości stanu widoku (zadanie 6c).
// Uruchom: npx tsx lib/viewPrefs.test.ts
import assert from "node:assert";
import { loadViewPrefs, saveViewPrefs, planHydration, type ViewPrefs } from "./viewPrefs.ts";

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

// ── 4. planHydration: z prefs → przywracamy TYLKO preferencje prezentacji ──
// (Nowe zachowanie: żaden widok/filtr nie jest pre-selekcjonowany na wejściu;
// stan początkowy to zawsze „Wszystkie". Z prefs bierzemy jedynie viewMode/sort.)
const planWithPrefs = planHydration(prefs);
ok("z prefs: przywraca preferencje prezentacji", planWithPrefs.restoreDisplayFromPrefs === true);

// ── 5. planHydration: pierwsza wizyta bez prefs → nic nie przywracamy ──
const planFirst = planHydration(null);
ok("pierwsza wizyta: nie przywraca prefs (start = Wszystkie)", planFirst.restoreDisplayFromPrefs === false);

console.log(`✓ Wszystkie ${passed} asercji przeszły — trwałość stanu widoku działa.`);
