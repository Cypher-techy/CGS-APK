"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Field } from "@/components/ui";
import { OBSERVATION_TYPES } from "@/lib/constants";
import { syncOfflineRecord } from "@/modules/monitoring/actions";

interface QueuedReport {
  client_id: string;
  user_id: string;
  saved_at: string;
  fields: Record<string, string>;
  photos: { name: string; type: string; blob: Blob }[];
  error?: string;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Today's date on the device (the stored page may be days old, so the server's date cannot be used). */
function deviceToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const DB_NAME = "cgs-offline";
const STORE = "reports";

/** Minimal IndexedDB access: reports (with photographs) waiting to be sent. */
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "client_id" });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

/**
 * Field report form that works without a connection. Reports are stored on the device and sent
 * when the device is online again. Open this page once while online so the device keeps a copy of it.
 */
export function OfflineCapture({
  projects,
  userId,
  maxDate,
}: {
  projects: { id: string; name: string; code: string }[];
  userId: string;
  maxDate: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState("tree_planting");
  const [coords, setCoords] = useState({ latitude: "", longitude: "" });
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const dateRef = useRef<HTMLInputElement>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ready, setReady] = useState<"checking" | "ready" | "unsupported">("checking");
  const syncingRef = useRef(false);

  const loadQueue = useCallback(async () => {
    const all = await withStore<QueuedReport[]>("readonly", (store) => store.getAll());
    setQueue(all.filter((r) => r.user_id === userId).sort((a, b) => a.saved_at.localeCompare(b.saved_at)));
  }, [userId]);

  const sync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    let sent = 0;
    let failed = 0;
    try {
      const all = await withStore<QueuedReport[]>("readonly", (store) => store.getAll());
      for (const report of all.filter((r) => r.user_id === userId)) {
        const formData = new FormData();
        formData.set("client_id", report.client_id);
        for (const [key, value] of Object.entries(report.fields)) formData.set(key, value);
        for (const photo of report.photos) formData.append("photos", new File([photo.blob], photo.name, { type: photo.type }));
        try {
          const result = await syncOfflineRecord(formData);
          if (result.ok) {
            await withStore("readwrite", (store) => store.delete(report.client_id));
            sent++;
          } else {
            await withStore("readwrite", (store) => store.put({ ...report, error: result.message }));
            failed++;
          }
        } catch {
          // Connection dropped again: keep the report and stop.
          failed++;
          break;
        }
      }
      if (sent || failed) {
        setMessage({ ok: failed === 0, text: `${sent} report${sent === 1 ? "" : "s"} sent${failed ? `, ${failed} not sent (see below)` : ""}.` });
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await loadQueue();
    }
  }, [userId, loadQueue]);

  useEffect(() => {
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    // Read the device's queue once the page is up, then try to send it.
    const start = window.setTimeout(() => void loadQueue().then(() => sync()), 0);
    if (dateRef.current) dateRef.current.value = deviceToday();

    const supported = "serviceWorker" in navigator && "indexedDB" in window;
    (supported ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready) : Promise.reject(new Error("unsupported")))
      .then(() => setReady("ready"))
      .catch(() => setReady("unsupported"));
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("online", onOnline);
    };
  }, [loadQueue, sync]);

  function captureLocation() {
    if (!("geolocation" in navigator)) return setMessage({ ok: false, text: "This device does not provide a location. Enter the coordinates manually." });
    navigator.geolocation.getCurrentPosition(
      (position) => setCoords({ latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) }),
      () => setMessage({ ok: false, text: "Location could not be read. Allow location access or enter the coordinates manually." }),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields: Record<string, string> = {};
    data.forEach((value, key) => {
      if (typeof value === "string") fields[key] = value;
    });
    const files = data.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 3) return setMessage({ ok: false, text: "Attach at most 3 photographs per report." });
    if (files.some((f) => f.size > 10 * 1024 * 1024)) return setMessage({ ok: false, text: "Each photograph must be 10 MB or smaller." });

    const report: QueuedReport = {
      client_id: crypto.randomUUID(),
      user_id: userId,
      saved_at: new Date().toISOString(),
      fields,
      photos: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
    };
    try {
      await withStore("readwrite", (store) => store.put(report));
    } catch {
      return setMessage({ ok: false, text: "The report could not be stored on this device. Free up storage space and try again." });
    }
    formRef.current?.reset();
    if (dateRef.current) dateRef.current.value = deviceToday();
    setCoords({ latitude: "", longitude: "" });
    setMessage({ ok: true, text: navigator.onLine ? "Report saved. Sending now." : "Report saved on this device. It will be sent when you are back online." });
    await loadQueue();
    void sync();
  }

  async function discard(clientId: string) {
    if (!window.confirm("Discard this unsent report? It will be lost.")) return;
    await withStore("readwrite", (store) => store.delete(clientId));
    await loadQueue();
  }

  const fields = OBSERVATION_TYPES[type]?.fields ?? [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";

  return (
    <div className="space-y-5">
      <div className={`alert ${online ? "alert-success" : "alert-warning"}`} role="status">
        <p className="font-medium">{online ? "Online" : "Offline"} · {queue.length} report{queue.length === 1 ? "" : "s"} waiting to be sent</p>
        <p className="mt-0.5 text-xs">
          {ready === "ready" && "This page is stored on the device and can be opened without a connection."}
          {ready === "checking" && "Preparing offline use…"}
          {ready === "unsupported" && "This browser cannot store the page for offline use. Reports saved here are still kept on the device, but the page itself needs a connection to open."}
        </p>
      </div>

      {queue.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between gap-3 border-b border-subtle-border px-4 py-3 sm:px-5">
            <h2 className="section-title">Reports waiting on this device</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void sync()} disabled={!online || syncing}>
              {syncing ? "Sending…" : "Send now"}
            </button>
          </div>
          <ul className="divide-y divide-subtle-border">
            {queue.map((report) => (
              <li key={report.client_id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <span>
                  {OBSERVATION_TYPES[report.fields.observation_type]?.label} · {projectName(report.fields.project_id)} · {report.fields.observation_date}
                  <span className="block text-xs text-muted-grey">
                    {report.photos.length} photograph{report.photos.length === 1 ? "" : "s"} · saved {new Date(report.saved_at).toLocaleString()}
                  </span>
                  {report.error && <span className="block text-xs text-red-300">Not sent: {report.error}</span>}
                </span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void discard(report.client_id)}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {message && (
        <p role="status" className={`alert ${message.ok ? "alert-success" : "alert-error"}`}>
          {message.text}
        </p>
      )}

      <section className="card card-pad">
        <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Project">
              <select name="project_id" className="input" required defaultValue="">
                <option value="" disabled>Select a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Observation type">
              <select name="observation_type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(OBSERVATION_TYPES).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Observation date">
              <input ref={dateRef} name="observation_date" type="date" className="input" required defaultValue={maxDate} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Latitude">
              <input name="latitude" type="number" step="0.000001" min="-90" max="90" inputMode="decimal" className="input" value={coords.latitude} onChange={(e) => setCoords({ ...coords, latitude: e.target.value })} />
            </Field>
            <Field label="Longitude">
              <input name="longitude" type="number" step="0.000001" min="-180" max="180" inputMode="decimal" className="input" value={coords.longitude} onChange={(e) => setCoords({ ...coords, longitude: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <button type="button" className="btn btn-secondary w-full" onClick={captureLocation}>Use my current location</button>
            </div>
          </div>
          {fields.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              {fields.map((field) => (
                <Field key={`${type}-${field.key}`} label={field.unit ? `${field.label} (${field.unit})` : field.label}>
                  <input
                    name={`m_${field.key}`}
                    type={field.type === "number" ? "number" : "text"}
                    step={field.type === "number" ? "any" : undefined}
                    min={field.type === "number" ? 0 : undefined}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    maxLength={field.type === "text" ? 300 : undefined}
                    className="input"
                  />
                </Field>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Basis of the figures">
              <select name="value_basis" className="input" defaultValue="measured">
                <option value="measured">Measured in the field</option>
                <option value="estimated">Estimated</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Method (optional)">
                <input name="methodology" className="input" maxLength={1000} />
              </Field>
            </div>
          </div>
          <Field label="Observations and description" hint="At least 10 characters.">
            <textarea name="description" className="input" rows={4} required minLength={10} maxLength={5000} />
          </Field>
          <Field label="Photographs (optional)" hint="Up to 3 images (JPG, PNG or WEBP), 10 MB each. They are kept on the device until sent.">
            <input name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="input" />
          </Field>
          <button type="submit" className="btn btn-primary">Save report</button>
        </form>
      </section>
    </div>
  );
}
