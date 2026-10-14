/**
 * Font of the new UI (prompt 15): Inter with Latin, Latin Extended (ə, ğ, ş) and Cyrillic.
 * Exposed as --ds-font-face, which theme.css puts first in --ds-font-sans. Import this only
 * where a <DesignScope> is rendered, so existing pages load no extra font files.
 */
import { Inter } from "next/font/google";

export const dsFont = Inter({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  variable: "--ds-font-face",
  display: "swap",
});
