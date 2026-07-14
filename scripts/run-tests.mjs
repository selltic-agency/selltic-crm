// scripts/run-tests.mjs — prosty, przenośny runner testów.
// Znajduje wszystkie lib/**/*.test.ts i ładuje je po kolei. Każdy plik testowy
// to samodzielny skrypt na node:assert, który rzuca wyjątkiem przy niepowodzeniu
// (i wypisuje "OK" przy sukcesie). Uruchamiane przez `npm test`, które dokłada
// flagi: --experimental-strip-types (typy TS) i --import ts-alias-loader (alias @/).
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = walk(ROOT).sort();
if (files.length === 0) {
  console.error("Nie znaleziono żadnych plików *.test.ts");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  try {
    await import(pathToFileURL(file).href);
    console.log(`✓ ${rel}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${rel}`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  }
}

console.log(`\n${files.length - failed}/${files.length} plików testowych przeszło.`);
process.exit(failed > 0 ? 1 : 0);
