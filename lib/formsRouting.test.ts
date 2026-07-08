// Test regresyjny routingu formularza — chroni przed powrotem krytycznego
// błędu „zgłoszenia znikają” (item 6): dotarcie do kroku „end” MUSI wyzwalać
// wysyłkę (onSubmit), a nie ciche wejście w krok końcowy.
// Uruchomienie: node --experimental-strip-types lib/formsRouting.test.ts
import assert from "node:assert";
import { resolveNextAction, NEXT, SUBMIT, type RoutingStep } from "./formsRouting.ts";

function step(id: string, type: string, next = NEXT): RoutingStep {
  return { id, type, next };
}

// Typowy formularz: welcome → email → phone → end.
const steps: RoutingStep[] = [
  step("w", "welcome"),
  step("e", "email"),
  step("p", "phone"),
  step("end", "end", SUBMIT),
];

// Krok „phone” (index 2) idzie liniowo (NEXT). Następny to „end” — więc to
// powinno być WYSŁANIE, nie przejście. To sedno naprawy błędu #6.
assert.deepStrictEqual(
  resolveNextAction(steps, 2, NEXT),
  { kind: "submit" },
  "liniowe dotarcie do kroku end = submit"
);

// Kroki pośrednie idą do następnego kroku (nie wysyłają).
assert.deepStrictEqual(resolveNextAction(steps, 0, NEXT), { kind: "goto", id: "e" });
assert.deepStrictEqual(resolveNextAction(steps, 1, NEXT), { kind: "goto", id: "p" });

// Jawny cel SUBMIT zawsze wysyła.
assert.deepStrictEqual(resolveNextAction(steps, 1, SUBMIT), { kind: "submit" });

// Skok bezpośrednio do kroku „end” (po id) też wysyła.
assert.deepStrictEqual(resolveNextAction(steps, 0, "end"), { kind: "submit" });

// Skok do konkretnego, zwykłego kroku po id.
assert.deepStrictEqual(resolveNextAction(steps, 0, "p"), { kind: "goto", id: "p" });

// Formularz bez kroku „end”: ostatni krok liniowo = submit.
const noEnd: RoutingStep[] = [step("a", "short_text"), step("b", "short_text")];
assert.deepStrictEqual(resolveNextAction(noEnd, 1, NEXT), { kind: "submit" });

// Domyślny 2-krokowy formularz (welcome → end): welcome liniowo = submit.
const twoStep: RoutingStep[] = [step("w", "welcome"), step("end", "end", SUBMIT)];
assert.deepStrictEqual(
  resolveNextAction(twoStep, 0, NEXT),
  { kind: "submit" },
  "domyślny formularz (welcome→end) wysyła po welcome"
);

console.log("formsRouting.test.ts — OK");
