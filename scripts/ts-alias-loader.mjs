// scripts/ts-alias-loader.mjs — resolwer aliasu ścieżek dla testów (node --test).
// Odwzorowuje alias "@/..." z tsconfig (paths: { "@/*": ["./*"] }) na pliki w
// katalogu projektu i dokłada rozszerzenie .ts/.tsx, którego importy w kodzie
// aplikacji nie podają (Next/webpack rozwiązuje je sam). Dzięki temu moduły
// używające importów wartościowych "@/lib/..." można ładować w czystym Node
// pod flagą --experimental-strip-types, bez uruchamiania całego bundlera.
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// Kandydaci na plik: dokładna ścieżka, warianty z rozszerzeniem, index w katalogu.
function candidates(basePath) {
  return [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    resolvePath(basePath, "index.ts"),
    resolvePath(basePath, "index.tsx"),
  ];
}

function firstExistingFile(basePath) {
  for (const c of candidates(basePath)) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Alias "@/x" → <root>/x (z rozwiązaniem rozszerzenia).
  if (specifier.startsWith("@/")) {
    const file = firstExistingFile(resolvePath(ROOT, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }

  // Relatywne importy bez rozszerzenia (np. "./ui") wskazujące na plik .ts/.tsx.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = resolvePath(dirname(parentPath), specifier);
    if (!existsSync(base) || !statSync(base).isFile()) {
      const file = firstExistingFile(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
