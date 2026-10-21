"use client";

import { useEffect } from "react";

/**
 * Rendered on the sign-in page: removes the stored copy of the offline capture page, which shows
 * the previous user's name and projects. Unsent reports stay on the device and are only ever sent
 * by the account that recorded them.
 */
export function ClearOfflineCopy() {
  useEffect(() => {
    if ("caches" in window) void caches.delete("cgs-offline-v1");
  }, []);
  return null;
}
