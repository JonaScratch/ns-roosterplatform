import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roosterplatform",
  description: "Interne toepassing voor roosterbeheer en medewerkers.",
  // Een interne toepassing hoort niet in een zoekindex te belanden, ook niet
  // wanneer een omgeving per ongeluk bereikbaar is vanaf internet.
  robots: { index: false, follow: false },
};

/**
 * Systeemlettertypen, bewust.
 *
 * Een webfont ophalen bij het bouwen maakt de build afhankelijk van een externe
 * dienst, en bij het laden maakt het de eerste weergave afhankelijk van een
 * verbinding die er in een bedrijfsnetwerk misschien niet is. Voor een
 * toepassing die de hele dag openstaat, weegt dat zwaarder dan de keuze van een
 * letter.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
