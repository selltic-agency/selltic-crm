// Testy §7b — mapowanie pól → właściwości CRM, koercja, zgodność typów.
import assert from "node:assert";
import {
  isCompatible,
  compatibleTargetTypes,
  coerceValue,
  resolveMappedValues,
} from "./leadMapping.ts";
import type { FormField } from "./forms.ts";

// Zgodność typów: multi_choice NIE mapuje się na number.
assert.strictEqual(isCompatible("multi_choice", "number"), false);
assert.strictEqual(isCompatible("single_choice", "number"), true);
assert.strictEqual(isCompatible("multi_choice", "multi_select"), true);
assert.strictEqual(isCompatible("email", "email"), true);

// compatibleTargetTypes odwzorowuje kompatybilność.
assert.ok(compatibleTargetTypes("multi_choice").includes("multi_select"));
assert.ok(!compatibleTargetTypes("multi_choice").includes("number"));

// Koercja number: poprawna liczba, błąd → fail.
assert.deepStrictEqual(coerceValue("1200 zł", "number"), { ok: true, value: 1200 });
assert.strictEqual(coerceValue("abc", "number").ok, false);

// Koercja boolean.
assert.deepStrictEqual(coerceValue("Tak", "boolean"), { ok: true, value: true });

// Select wymaga optionMap; brak mapowania → fail.
assert.strictEqual(coerceValue("Opcja A", "select").ok, false);
assert.deepStrictEqual(
  coerceValue("Opcja A", "select", { "Opcja A": "opt_a" }),
  { ok: true, value: "opt_a" }
);

// resolveMappedValues: wbudowane + własne + ostrzeżenia (koercja nieudana).
const fields: FormField[] = [
  { id: "e", type: "email", question: "E-mail", mapping: { property: "email", target: "builtin" } },
  { id: "v", type: "short_text", question: "Budżet", mapping: { property: "value", target: "builtin" } },
  { id: "n", type: "short_text", question: "Liczba", mapping: { property: "custom_num", target: "custom" } },
];
const answers = { e: "a@b.pl", v: "5000", n: "nie-liczba" };
const res = resolveMappedValues(fields, answers, (k) => (k === "custom_num" ? "number" : undefined));

assert.strictEqual(res.builtin.email, "a@b.pl");
assert.strictEqual(res.builtin.value, 5000);
// „custom_num” nie skoerceowane → pominięte + ostrzeżenie (nie blokuje leadu).
assert.strictEqual(res.props.custom_num, undefined);
assert.ok(res.warnings.some((w) => w.property === "custom_num"));

// Usunięta właściwość własna → ostrzeżenie „właściwość usunięta”, pominięta.
const res2 = resolveMappedValues(
  [{ id: "x", type: "short_text", question: "X", mapping: { property: "gone", target: "custom" } }],
  { x: "wartość" },
  () => undefined
);
assert.ok(res2.warnings.some((w) => w.reason === "właściwość usunięta"));

console.log("leadMapping.test.ts — OK");
