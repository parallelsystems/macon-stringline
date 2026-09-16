/**
 * Brand / theme tokens. Single place to apply company branding.
 *
 * Palette is from "Parallel Brand Guidelines 20250604.pdf" in src/assets/brand/:
 * black, white, and pure grays as the foundation, with Parallel Red used
 * selectively to draw attention. The extended tints (yellow / green / blue)
 * exist for UI state colors — use them if a state color is ever needed, rather
 * than inventing new ones.
 *
 * The Tailwind utility tokens (bg-brand, bg-brand-paper, …) in index.css
 * @theme mirror these values — keep the two in sync. Job-type colors stay in
 * data/network.js because they're operational semantics (road vs yard vs MOW),
 * not branding — don't merge them into this palette.
 */
import logo from "./assets/brand/parallel-logo-black.svg";

export const BRAND = {
  productName: "Traffic Planner",
  line: "Macon — Pooler",
  railroad: "", // the logo already carries the company name

  logo,

  colors: {
    primary: "#151515", // Parallel Black — chrome, selected states
    accent: "#FA5543", // Parallel Red — selective attention (meet markers)

    // Main palette
    grayA: "#1F1F1F",
    grayB: "#333333",
    midGray: "#8A8A8A",
    lightGrayD: "#E6E6E6",
    lightGrayE: "#F2F2F2",

    // Extended functional palette — light / base / dark tints
    red: { light: "#FC998E", base: "#FA5543", dark: "#A02222" },
    yellow: { light: "#FFE389", base: "#FFD13B", dark: "#9D6C0C" },
    green: { light: "#8FD58F", base: "#44B944", dark: "#1D7C38" },
    blue: { light: "#A1BEF8", base: "#497EE9", dark: "#1D3D7C" },
  },
};
