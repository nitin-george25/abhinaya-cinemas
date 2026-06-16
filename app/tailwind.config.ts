import type { Config } from "tailwindcss";

// Abhinaya brand palette — pulled from the existing admin/dcr/style.css so
// the new app stays visually continuous with the old one through the rewrite.
// We can refine these later; for now we just want a usable token system.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        amber: {
          DEFAULT: "#F7B61F",
          50:  "#FFF7E0",
          100: "#FCE9B0",
          200: "#FAD978",
          300: "#F8C944",
          400: "#F7B61F",
          500: "#E1A20F",
          600: "#B7820A",
        },
        ink: {
          DEFAULT: "#0F1115",
          soft:    "#1A1D24",
          muted:   "#5C6470",
        },
        paper: {
          DEFAULT: "#FAFAF8",
          card:    "#FFFFFF",
        },
        line: "#E6E4DE",
      },
      fontFamily: {
        // Body / default. Barlow Semi Condensed first, then a clean system
        // sans fallback. This is what `font-sans` (Tailwind's default) maps
        // to and what <body> inherits.
        sans: [
          "Barlow Semi Condensed",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Primary display. Pontiac for the wordmark + large headings, with
        // Barlow as the per-glyph fallback for characters Pontiac DEMO is
        // missing (apostrophe, '4', etc — handled per-glyph by the browser
        // when a font lacks a glyph).
        // Apply via `font-display` Tailwind class.
        display: [
          "Pontiac",
          "Barlow Semi Condensed",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
        // Malayalam (bilingual SOP checklists). Anek Malayalam pairs with
        // Barlow; loaded from Google Fonts in index.html. Apply via
        // `font-malayalam`.
        malayalam: [
          "Anek Malayalam",
          "Barlow Semi Condensed",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 17, 21, 0.04), 0 1px 3px rgba(15, 17, 21, 0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
