import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SentinAI — Autonomous Node Guardian for L2 Infrastructure",
  description:
    "SentinAI detects incidents, plans actions by policy, and helps teams recover safely with approval-gated automation.",
  openGraph: {
    title: "SentinAI — Autonomous Node Guardian for L2 Infrastructure",
    description:
      "Autonomous monitoring and auto-scaling for L2 networks. Observe, Decide, Act.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${ibmPlexMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
