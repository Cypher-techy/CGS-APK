import { randomUUID } from "node:crypto";
import { IMAGE_EXTENSIONS, UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "@/lib/constants";
import type { Supabase } from "@/lib/supabase/server";

export const BUCKET = "project-files";

export interface StoredFile {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Validates a file (type by extension, size) and uploads it to the private bucket under the
 * project's folder. The bucket repeats the size and type limits, and storage policies only
 * accept uploads from participants of that project.
 */
export async function storeFile(
  supabase: Supabase,
  projectId: string,
  file: File,
  imagesOnly = false,
): Promise<{ stored: StoredFile; error: null } | { stored: null; error: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = UPLOAD_TYPES[extension];
  if (!mime || (imagesOnly && !IMAGE_EXTENSIONS.includes(extension))) {
    const allowed = imagesOnly ? IMAGE_EXTENSIONS : Object.keys(UPLOAD_TYPES);
    return { stored: null, error: `"${file.name}" is not an accepted file type. Allowed: ${allowed.join(", ")}.` };
  }
  if (file.size === 0) return { stored: null, error: `"${file.name}" is empty.` };
  if (file.size > UPLOAD_MAX_BYTES) return { stored: null, error: `"${file.name}" is larger than 10 MB.` };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
  const path = `${projectId}/${randomUUID()}-${safeName}`;
  // Sent as raw bytes so the content type derived from the extension is used, not whatever the browser reported.
  const { error } = await supabase.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: mime, upsert: false });
  if (error) {
    console.error("Upload failed:", error.message);
    return { stored: null, error: `"${file.name}" could not be uploaded. Check that you are a member of this project.` };
  }
  return { stored: { storage_path: path, file_name: file.name.slice(-200), mime_type: mime, size_bytes: file.size }, error: null };
}

export function isFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "size" in value && value.size > 0;
}
