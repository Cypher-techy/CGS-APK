import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // File uploads are posted through server actions (each file is capped at 10 MB).
  experimental: { serverActions: { bodySizeLimit: "32mb" } },
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
};

export default nextConfig;
