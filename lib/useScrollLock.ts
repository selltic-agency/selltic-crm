// lib/useScrollLock.ts — blokada przewijania całej strony, gdy otwarty jest
// modal / szuflada / tryb pełnoekranowy. Dzięki temu przewijanie żyje wtedy
// wyłącznie wewnątrz otwartego okna (jego wewnętrzne przewijalne boksy), a tło
// pozostaje nieruchome. Obsługuje zagnieżdżenie (licznik referencji) — jeśli
// nad szufladą otworzy się modal, tło odblokuje się dopiero po zamknięciu obu.
"use client";

import { useEffect } from "react";

let lockCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

export function useScrollLock(active: boolean = true): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const body = document.body;

    if (lockCount === 0) {
      savedOverflow = body.style.overflow;
      savedPaddingRight = body.style.paddingRight;
      // Kompensacja szerokości paska przewijania — bez tego treść „skacze"
      // w bok w chwili zablokowania (znika systemowy scrollbar).
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
      body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        body.style.overflow = savedOverflow;
        body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [active]);
}
