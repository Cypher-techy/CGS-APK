import { permanentRedirect } from "next/navigation";

/** The former "Platform Overview" page is now "How it works". */
export default function PlatformPage() {
  permanentRedirect("/how-it-works");
}
