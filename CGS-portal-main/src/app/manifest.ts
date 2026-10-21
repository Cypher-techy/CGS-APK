import type { MetadataRoute } from "next";

// Web app manifest. It makes the portal installable ("Add to Home screen") and it is what the
// Android Trusted Web Activity wrapper reads when the APK is built with Bubblewrap.
// The icons live in public/icons/; maskable-512.png keeps the CGS mark inside the safe zone
// so Android can crop it to any launcher shape.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cypher Green Systems (CGS)",
    short_name: "CGS",
    description:
      "Environmental intelligence infrastructure for Africa: project management, GIS, field monitoring, MRV and a carbon project marketplace.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    lang: "en",
    dir: "ltr",
    categories: ["business", "education", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-48.png", sizes: "48x48", type: "image/png", purpose: "any" },
      { src: "/icons/icon-72.png", sizes: "72x72", type: "image/png", purpose: "any" },
      { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png", purpose: "any" },
      { src: "/icons/icon-144.png", sizes: "144x144", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Student Portal", short_name: "FERD", url: "/ferd" },
      { name: "Explore the map", short_name: "Explore", url: "/explore" },
      { name: "Dashboard", short_name: "Dashboard", url: "/dashboard" },
    ],
  };
}
