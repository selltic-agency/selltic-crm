// lib/responsive.ts — hook do wykrywania widoku mobilnego (matchMedia).
// Renderuje desktop po stronie serwera; po zamontowaniu koryguje na kliencie
// (brak niezgodności hydracji — pierwszy render klienta też zwraca false).
"use client";

import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 900): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
