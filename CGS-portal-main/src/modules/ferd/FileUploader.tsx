"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createContent, prepareContentUploads, registerContentUploads } from "@/modules/ferd/admin-actions";
import { FERD_UPLOAD_BATCH, FERD_UPLOAD_MAX_BYTES, FERD_UPLOAD_MAX_FILES, FERD_UPLOAD_MAX_LABEL, FERD_UPLOAD_TYPES } from "@/modules/ferd/constants";

const ACCEPT = Object.keys(FERD_UPLOAD_TYPES).map((ext) => `.${ext}`).join(",");
const FILE_HINT = `Up to ${FERD_UPLOAD_MAX_FILES} files, ${FERD_UPLOAD_MAX_LABEL} each. ${Object.keys(FERD_UPLOAD_TYPES).join(", ")}.`;

type Kind = "attachment" | "image";
type Progress = { name: string; fraction: number } | null;
type Outcome = { ok: boolean; text: string };

const chosenFiles = (data: FormData) => data.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

/** What is wrong with a selection, checked in the browser before anything is sent. The server checks again. */
function selectionProblem(files: File[], kind: Kind): string | null {
  if (files.length > FERD_UPLOAD_MAX_FILES) return `Upload at most ${FERD_UPLOAD_MAX_FILES} files at a time.`;
  for (const file of files) {
    const mime = FERD_UPLOAD_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (!mime) return `“${file.name}”: this file type is not allowed. Allowed: ${Object.keys(FERD_UPLOAD_TYPES).join(", ")}.`;
    if (kind === "image" && !mime.startsWith("image/")) return `“${file.name}” is not an image. Gallery photos must be JPG, PNG or WEBP.`;
    if (file.size > FERD_UPLOAD_MAX_BYTES) return `“${file.name}” is larger than ${FERD_UPLOAD_MAX_LABEL}.`;
  }
  return null;
}

/** Sends one file straight to private storage through a one-time upload link, reporting progress. */
function send(url: string, file: File, mime: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", mime);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`storage answered ${request.status}`)));
    request.onerror = () => reject(new Error("the connection was interrupted"));
    request.send(file);
  });
}

/**
 * Uploads files for one content item. The files go from the browser directly to private storage, so their
 * size is not limited by the web server; the server issues the upload links and records each file only
 * after checking what actually arrived.
 */
async function uploadBatch(contentId: string, kind: Kind, caption: string, files: File[], onProgress: (progress: Progress) => void): Promise<Outcome & { saved: number }> {
  const prepared = await prepareContentUploads(contentId, kind, files.map((file) => ({ name: file.name, size: file.size })));
  if ("error" in prepared) return { ok: false, text: prepared.error, saved: 0 };
  const sent: { path: string; name: string }[] = [];
  let failure = "";
  for (const [index, file] of files.entries()) {
    const target = prepared.uploads[index];
    onProgress({ name: file.name, fraction: 0 });
    try {
      await send(target.url, file, target.mime, (fraction) => onProgress({ name: file.name, fraction }));
      sent.push({ path: target.path, name: file.name });
    } catch (error) {
      failure = `“${file.name}” could not be uploaded: ${error instanceof Error ? error.message : "unknown error"}.`;
      break;
    }
  }
  onProgress(null);
  if (sent.length === 0) return { ok: false, text: failure, saved: 0 };
  const result = await registerContentUploads(contentId, kind, caption, sent);
  if (!result?.ok) return { ok: false, text: [result?.message, failure].filter(Boolean).join(" "), saved: 0 };
  return { ok: !failure, text: failure, saved: sent.length };
}

/** Uploads any number of chosen files, a batch at a time, and stops at the first batch that fails. */
async function uploadFiles(contentId: string, kind: Kind, caption: string, files: File[], onProgress: (progress: Progress) => void): Promise<Outcome> {
  let saved = 0;
  for (let start = 0; start < files.length; start += FERD_UPLOAD_BATCH) {
    const batch = await uploadBatch(contentId, kind, caption, files.slice(start, start + FERD_UPLOAD_BATCH), (progress) =>
      onProgress(progress && { ...progress, name: `${progress.name} (${saved} of ${files.length} files done)` }),
    );
    saved += batch.saved;
    if (!batch.ok) return { ok: false, text: `${saved} of ${files.length} files uploaded. ${batch.text}`.trim() };
  }
  return { ok: true, text: `${saved} file${saved === 1 ? "" : "s"} uploaded.` };
}

function ProgressBar({ progress }: { progress: Progress }) {
  if (!progress) return null;
  const percent = Math.round(progress.fraction * 100);
  return (
    <div role="status" aria-live="polite">
      <p className="truncate text-xs text-muted-grey">Uploading {progress.name}: {percent}%</p>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-primary-green transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** File picker and "use as" choice, shared by the new-content form and the uploader on an existing item. */
export function FileFields({ required = false, disabled = false }: { required?: boolean; disabled?: boolean }) {
  return (
    <>
      <label className="block sm:col-span-2">
        <span className="label">Files from your computer or phone</span>
        <input name="files" type="file" multiple required={required} accept={ACCEPT} className="input" disabled={disabled} />
        <span className="mt-1 block text-xs text-muted-grey">{FILE_HINT}</span>
      </label>
      <label className="block">
        <span className="label">Use as</span>
        <select name="files_kind" className="input" defaultValue="attachment" disabled={disabled}>
          <option value="attachment">Attachment (download)</option>
          <option value="image">Gallery photo</option>
        </select>
      </label>
    </>
  );
}

/** Adds files and photos to an existing content item. */
export function FileUploader({ contentId }: { contentId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [message, setMessage] = useState<Outcome | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const files = chosenFiles(data);
    const kind: Kind = data.get("files_kind") === "image" ? "image" : "attachment";
    setMessage(null);
    if (files.length === 0) return setMessage({ ok: false, text: "Choose at least one file." });
    const problem = selectionProblem(files, kind);
    if (problem) return setMessage({ ok: false, text: problem });
    setBusy(true);
    try {
      const outcome = await uploadFiles(contentId, kind, String(data.get("caption") ?? ""), files, setProgress);
      setMessage(outcome);
      if (outcome.ok) form.current?.reset();
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "The upload could not be completed. Check your connection and try again." });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FileFields required disabled={busy} />
        <label className="block sm:col-span-3">
          <span className="label">Caption (optional)</span>
          <input name="caption" className="input" maxLength={300} disabled={busy} />
        </label>
      </div>
      <ProgressBar progress={progress} />
      {message && <p className={`alert ${message.ok ? "alert-success" : "alert-error"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
    </form>
  );
}

/**
 * Form for a new content item. It creates the item, uploads any files chosen in the same form, then opens
 * the item's page. The children are the editor's fields.
 */
export function NewContentForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState<Progress>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const files = chosenFiles(data);
    const kind: Kind = data.get("files_kind") === "image" ? "image" : "attachment";
    data.delete("files");
    data.delete("files_kind");
    setError("");
    // The files are checked before the item is created, so a refused file does not leave an empty item behind.
    const problem = selectionProblem(files, kind);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      setStep("Saving…");
      const created = await createContent(data);
      if ("error" in created) return setError(created.error);
      let query = "created=1";
      if (files.length) {
        setStep("Uploading files…");
        const outcome = await uploadFiles(created.id, kind, "", files, setProgress).catch(() => ({ ok: false, text: "" }));
        query += outcome.ok ? `&uploaded=${files.length}` : "&upload=failed";
      }
      router.push(`/ferd/admin/content/${created.id}?${query}`);
    } catch {
      setError("The item could not be saved. Check your connection and try again.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset disabled={busy} className="m-0 min-w-0 space-y-6 border-0 p-0">
        {children}
      </fieldset>
      <ProgressBar progress={progress} />
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? step || "Working…" : "Create"}</button>
    </form>
  );
}
