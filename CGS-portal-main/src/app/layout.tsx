import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Satoshi (Indian Type Foundry, free licence) is the brand typeface, served by Fontshare.
// It loads in the browser, so the build needs no network access; system fonts are the fallback.
const SATOSHI = "https://api.fontshare.com/v2/css?f[]=satoshi@1&display=swap";

export const metadata: Metadata = {
  title: { default: "Cypher Green Systems (CGS)", template: "%s | Cypher Green Systems" },
  description:
    "Cypher Green Systems (CGS): environmental intelligence infrastructure for Africa. Environmental project management, GIS, field monitoring, MRV and a carbon project marketplace on one geographic platform.",
  applicationName: "CGS",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "CGS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0b0b" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href={SATOSHI} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
