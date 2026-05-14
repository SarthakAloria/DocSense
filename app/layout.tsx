/**
 * app/layout.tsx — Root layout for DocSearch AI
 *
 * Purpose:
 *   Wraps every page with the HTML shell (<html>, <body>), injects the two
 *   Google Fonts used throughout the UI, and sets the page metadata that
 *   appears in browser tabs and search-engine previews.
 *
 * Fonts:
 *   Syne      (--font-syne)    — headings, labels, uppercase caps text
 *   DM Sans   (--font-dm-sans) — body copy, input text, message bubbles
 *
 *   Both are exposed as CSS custom properties via Next.js's `variable`
 *   option so they can be referenced in inline styles and the global
 *   stylesheet without hard-coding font-family strings everywhere.
 *
 * This layout renders only once on the server; it is NOT a Client Component.
 */

import type { Metadata } from "next";
import { Syne } from "next/font/google";
import { DM_Sans } from "next/font/google";
import "./globals.css";

// ─── Font configuration ───────────────────────────────────────────────────────

/**
 * Syne — used for display headings, sidebar section labels, and the logo.
 * Weights 400–700 are loaded to cover regular, medium, semi-bold and bold.
 */
const syne = Syne({
  variable: "--font-syne",   // CSS custom property name
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/**
 * DM Sans — used for body text, message bubbles, inputs, and buttons.
 * Weight 300 (light) is included for de-emphasised helper text.
 */
const dmSans = DM_Sans({
  variable: "--font-dm-sans",  // CSS custom property name
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

// ─── Page metadata ────────────────────────────────────────────────────────────

/**
 * Exported metadata is picked up by Next.js and injected into <head>.
 * Both `title` and `description` are used by social-media previews and SEO.
 */
export const metadata: Metadata = {
  title: "DocSearch AI",
  description: "Semantic search over your documents powered by Pinecone & OpenAI",
};

// ─── Layout component ─────────────────────────────────────────────────────────

/**
 * RootLayout
 *
 * Provides the outermost HTML structure for every route in the app.
 * The two font CSS variables are applied to <body> so all descendant
 * components can access them via `var(--font-syne)` and `var(--font-dm-sans)`.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/*
       * The font variable class names are concatenated on <body> so that
       * Next.js injects the @font-face rules and makes the CSS variables
       * available to both the global stylesheet and inline styles.
       */}
      <body className={`${syne.variable} ${dmSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}