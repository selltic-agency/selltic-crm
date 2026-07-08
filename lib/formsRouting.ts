// lib/formsRouting.ts — routing kroków formularza (leaf-module, bez zależności,
// więc testowalny bezpośrednio przez `node --experimental-strip-types`).

// Cele routingu: __next__ (liniowo), __submit__ (wyślij) lub id kroku.
export const NEXT = "__next__";
export const SUBMIT = "__submit__";

// Minimalny kształt kroku wymagany do rozstrzygnięcia routingu.
export type RoutingStep = { id: string; type: string; next?: string };

export type NextAction = { kind: "submit" } | { kind: "goto"; id: string };

// Rozstrzyga dokąd prowadzi przejście z bieżącego kroku dla danego celu
// (NEXT | SUBMIT | id kroku). KLUCZOWE: dotarcie do kroku „end” (albo brak
// kolejnego kroku) oznacza WYSŁANIE formularza. Wcześniej nawigacja liniowa
// wchodziła w krok „end” bez wywołania onSubmit — przez co zgłoszenie nigdy
// nie trafiało do backendu (krytyczny błąd „zgłoszenia znikają”).
export function resolveNextAction(
  steps: RoutingStep[],
  currentIndex: number,
  target: string
): NextAction {
  if (target === SUBMIT) return { kind: "submit" };
  if (!target || target === NEXT) {
    const next = steps[currentIndex + 1];
    if (!next || next.type === "end") return { kind: "submit" };
    return { kind: "goto", id: next.id };
  }
  const next = steps.find((s) => s.id === target);
  if (!next || next.type === "end") return { kind: "submit" };
  return { kind: "goto", id: next.id };
}
