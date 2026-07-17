// lib/sms/encoding.ts — kodowanie i liczenie segmentów SMS. CZYSTY moduł
// (bez `server-only`, bez tokenu) — używany zarówno przez serwer (przed wysyłką)
// jak i przez licznik na żywo w kompozytorze na kliencie.
//
// Zasady (GSM 03.38 / UCS-2):
//   • GSM-7:  160 znaków w 1 segmencie, 153 przy łączeniu wielu segmentów.
//   • UCS-2:  70 znaków w 1 segmencie, 67 przy łączeniu (wymuszane przez polskie
//     znaki diakrytyczne i inne znaki spoza GSM-7).
//   • Znaki z tablicy rozszerzeń GSM-7 (^ { } \ [ ] ~ | €) zajmują 2 septety.

export type SmsEncoding = "gsm7" | "ucs2";

// Podstawowy zestaw znaków GSM 03.38 (bez tablicy rozszerzeń).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// Tablica rozszerzeń GSM-7 — te znaki są reprezentowalne, ale kosztują 2 septety.
const GSM7_EXTENSION = "^{}\\[~]|€";

const GSM7_BASIC_SET = new Set([...GSM7_BASIC]);
const GSM7_EXTENSION_SET = new Set([...GSM7_EXTENSION]);

// Transliteracja polskich diakrytyków (i kilku typowych znaków) na ASCII, żeby
// utrzymać wiadomość na GSM-7. Używane przez przełącznik „usuń diakrytyki".
const TRANSLITERATION: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
  // Typowe znaki interpunkcyjne spoza GSM-7 (cudzysłowy, myślniki, wielokropek).
  "„": '"', "”": '"', "“": '"', "‘": "'", "’": "'",
  "–": "-", "—": "-", "…": "...", " ": " ",
};

// Zamienia polskie diakrytyki / typowe znaki na odpowiedniki ASCII. Znaki bez
// mapowania pozostają bez zmian (mogą nadal wymusić UCS-2).
export function stripDiacritics(text: string): string {
  let out = "";
  for (const ch of text) out += TRANSLITERATION[ch] ?? ch;
  return out;
}

// Czy CAŁY tekst mieści się w GSM-7 (podstawowy zestaw + rozszerzenia).
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC_SET.has(ch) && !GSM7_EXTENSION_SET.has(ch)) return false;
  }
  return true;
}

export type SegmentInfo = {
  encoding: SmsEncoding;
  length: number; // liczba jednostek rozliczeniowych (septety GSM-7 lub jednostki UTF-16)
  segments: number; // liczba segmentów (części) wiadomości
  perSegment: number; // pojemność jednego segmentu przy tym kodowaniu i długości
  remaining: number; // ile jednostek zostało do końca bieżącego segmentu
};

// Liczba septetów GSM-7 (znaki rozszerzeń liczą się podwójnie).
function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) len += GSM7_EXTENSION_SET.has(ch) ? 2 : 1;
  return len;
}

// Wylicza kodowanie, długość i liczbę segmentów dla treści SMS.
export function segmentInfo(text: string): SegmentInfo {
  const gsm = isGsm7(text);
  if (gsm) {
    const length = gsm7Length(text);
    const single = 160;
    const multi = 153;
    const segments = length === 0 ? 1 : length <= single ? 1 : Math.ceil(length / multi);
    const perSegment = segments <= 1 ? single : multi;
    const remaining = segments * perSegment - length;
    return { encoding: "gsm7", length, segments, perSegment, remaining };
  }
  // UCS-2 — liczymy jednostki UTF-16 (znaki spoza BMP zajmują 2).
  const length = text.length;
  const single = 70;
  const multi = 67;
  const segments = length === 0 ? 1 : length <= single ? 1 : Math.ceil(length / multi);
  const perSegment = segments <= 1 ? single : multi;
  const remaining = segments * perSegment - length;
  return { encoding: "ucs2", length, segments, perSegment, remaining };
}
