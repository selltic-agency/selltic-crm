// lib/theme.ts — design tokens from REQUIREMENTS.md §9.
// Single source of truth so every screen uses the same palette.
export const tokens = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  border: "#ECEEF3",
  text: "#1A1D26",
  muted: "#8A92A6",
  accent: "#6C5CE7",
  accentSoft: "rgba(108,92,231,0.10)",
  success: "#18A957",
  warning: "#F2994A",
  radius: 16,
} as const;
