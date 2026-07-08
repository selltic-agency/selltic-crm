// lib/phone.ts — lista międzynarodowych prefiksów telefonicznych + helpery.
// Używane przez krok „phone” w formularzach (selektor prefiksu + numer).

export type CountryPrefix = {
  iso: string; // kod kraju ISO (do klucza React)
  code: string; // prefiks z plusem, np. "+48"
  name: string; // nazwa kraju (PL)
  flag: string; // emoji flagi
};

// Domyślny prefiks (Polska).
export const DEFAULT_PHONE_PREFIX = "+48";

// Lista prefiksów — uporządkowana: najpierw popularne w PL, potem alfabetycznie.
export const COUNTRY_PREFIXES: CountryPrefix[] = [
  { iso: "PL", code: "+48", name: "Polska", flag: "🇵🇱" },
  { iso: "DE", code: "+49", name: "Niemcy", flag: "🇩🇪" },
  { iso: "GB", code: "+44", name: "Wielka Brytania", flag: "🇬🇧" },
  { iso: "US", code: "+1", name: "USA / Kanada", flag: "🇺🇸" },
  { iso: "CZ", code: "+420", name: "Czechy", flag: "🇨🇿" },
  { iso: "SK", code: "+421", name: "Słowacja", flag: "🇸🇰" },
  { iso: "UA", code: "+380", name: "Ukraina", flag: "🇺🇦" },
  { iso: "AT", code: "+43", name: "Austria", flag: "🇦🇹" },
  { iso: "BE", code: "+32", name: "Belgia", flag: "🇧🇪" },
  { iso: "BG", code: "+359", name: "Bułgaria", flag: "🇧🇬" },
  { iso: "HR", code: "+385", name: "Chorwacja", flag: "🇭🇷" },
  { iso: "CN", code: "+86", name: "Chiny", flag: "🇨🇳" },
  { iso: "CY", code: "+357", name: "Cypr", flag: "🇨🇾" },
  { iso: "DK", code: "+45", name: "Dania", flag: "🇩🇰" },
  { iso: "EE", code: "+372", name: "Estonia", flag: "🇪🇪" },
  { iso: "FI", code: "+358", name: "Finlandia", flag: "🇫🇮" },
  { iso: "FR", code: "+33", name: "Francja", flag: "🇫🇷" },
  { iso: "GR", code: "+30", name: "Grecja", flag: "🇬🇷" },
  { iso: "ES", code: "+34", name: "Hiszpania", flag: "🇪🇸" },
  { iso: "NL", code: "+31", name: "Holandia", flag: "🇳🇱" },
  { iso: "IE", code: "+353", name: "Irlandia", flag: "🇮🇪" },
  { iso: "IS", code: "+354", name: "Islandia", flag: "🇮🇸" },
  { iso: "IL", code: "+972", name: "Izrael", flag: "🇮🇱" },
  { iso: "JP", code: "+81", name: "Japonia", flag: "🇯🇵" },
  { iso: "CA", code: "+1", name: "Kanada", flag: "🇨🇦" },
  { iso: "LT", code: "+370", name: "Litwa", flag: "🇱🇹" },
  { iso: "LU", code: "+352", name: "Luksemburg", flag: "🇱🇺" },
  { iso: "LV", code: "+371", name: "Łotwa", flag: "🇱🇻" },
  { iso: "MT", code: "+356", name: "Malta", flag: "🇲🇹" },
  { iso: "NO", code: "+47", name: "Norwegia", flag: "🇳🇴" },
  { iso: "PT", code: "+351", name: "Portugalia", flag: "🇵🇹" },
  { iso: "RO", code: "+40", name: "Rumunia", flag: "🇷🇴" },
  { iso: "SI", code: "+386", name: "Słowenia", flag: "🇸🇮" },
  { iso: "CH", code: "+41", name: "Szwajcaria", flag: "🇨🇭" },
  { iso: "SE", code: "+46", name: "Szwecja", flag: "🇸🇪" },
  { iso: "TR", code: "+90", name: "Turcja", flag: "🇹🇷" },
  { iso: "HU", code: "+36", name: "Węgry", flag: "🇭🇺" },
  { iso: "IT", code: "+39", name: "Włochy", flag: "🇮🇹" },
  { iso: "AE", code: "+971", name: "ZEA", flag: "🇦🇪" },
  { iso: "AU", code: "+61", name: "Australia", flag: "🇦🇺" },
  { iso: "IN", code: "+91", name: "Indie", flag: "🇮🇳" },
  { iso: "BR", code: "+55", name: "Brazylia", flag: "🇧🇷" },
  { iso: "MX", code: "+52", name: "Meksyk", flag: "🇲🇽" },
];

export function prefixMeta(code: string): CountryPrefix | undefined {
  return COUNTRY_PREFIXES.find((p) => p.code === code);
}

// Waliduje numer (część bez prefiksu): same cyfry, 6–12 znaków po
// usunięciu spacji i myślników.
const PHONE_LOCAL_RE = /^\d{6,12}$/;

export function isValidPhoneLocal(local: string): boolean {
  const digits = (local ?? "").replace(/[\s-]/g, "");
  return PHONE_LOCAL_RE.test(digits);
}

// Zostawia same cyfry (usuwa spacje, myślniki, nawiasy, plus). Używane przez
// walidację telefonu oraz wyszukiwarkę (porównywanie numerów niezależnie od
// formatowania).
export function digitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

// Dozwolone dwucyfrowe prefiksy polskich numerów komórkowych (część po +48).
// Wzorce operatorów: 45x, 50x, 51x, 53x, 57x, 60x, 66x, 69x, 72x, 73x, 78x, 79x, 88x.
export const PL_MOBILE_PREFIXES = [
  "45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88",
];

// Waliduje część lokalną numeru (bez prefiksu kraju) w kontekście danego
// prefiksu. Dla Polski (+48): dokładnie 9 cyfr + poprawny prefiks operatora.
// Dla pozostałych krajów: łagodna walidacja 6–12 cyfr (bez zmiany zachowania).
// Zwraca komunikat błędu (PL) lub null gdy numer jest poprawny.
export function phoneLocalError(prefix: string, local: string): string | null {
  const digits = digitsOnly(local);
  if (prefix === "+48") {
    if (digits.length !== 9) {
      return "Nieprawidłowy numer telefonu — sprawdź liczbę cyfr (wymagane 9 po +48).";
    }
    if (!PL_MOBILE_PREFIXES.includes(digits.slice(0, 2))) {
      return "Nieprawidłowy numer telefonu — sprawdź prefiks operatora.";
    }
    return null;
  }
  // Inne kraje — dotychczasowa, łagodniejsza reguła.
  if (digits.length < 6 || digits.length > 12) {
    return "Podaj poprawny numer telefonu.";
  }
  return null;
}

// Sprowadza numer do jednego, spójnego formatu do zapisu/wyświetlenia.
// PL: "+48 XXX XXX XXX". Inne kraje: "<prefiks> <cyfry>".
export function formatPhoneValue(prefix: string, local: string): string {
  const digits = digitsOnly(local);
  if (!digits) return "";
  if (prefix === "+48" && digits.length === 9) {
    return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return `${prefix} ${digits}`;
}

// Rozdziela zapisaną wartość ("+48 123 456 789") na prefiks i część lokalną.
// Dopasowuje najdłuższy znany prefiks; w razie braku używa `fallback`.
export function splitPhone(
  value: string,
  fallback: string
): { prefix: string; local: string } {
  const v = (value ?? "").trim();
  if (v.startsWith("+")) {
    const match = [...COUNTRY_PREFIXES]
      .sort((a, b) => b.code.length - a.code.length)
      .find((p) => v.startsWith(p.code));
    if (match) return { prefix: match.code, local: v.slice(match.code.length).trim() };
  }
  return { prefix: fallback, local: v };
}
