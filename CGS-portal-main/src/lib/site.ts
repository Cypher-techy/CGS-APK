/** Public identity and contact details of the platform. */
export const SITE = {
  name: "Cypher Green Systems",
  short: "CGS",
  positioning: "Environmental Intelligence Infrastructure for Africa",
  descriptor: "Environmental Project Management & Carbon Project Marketplace",
  phone: "0110966455",
  phoneDisplay: "0110 966 455",
  /** International format for tel: and WhatsApp links (Kenya, +254). */
  phoneIntl: "254110966455",
  /** Set NEXT_PUBLIC_CONTACT_EMAIL to publish a contact address. None is shown until it is configured. */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
} as const;

export const PUBLIC_NAV = [
  { label: "Explore", href: "/explore" },
  { label: "Projects", href: "/projects" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Features", href: "/features" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
