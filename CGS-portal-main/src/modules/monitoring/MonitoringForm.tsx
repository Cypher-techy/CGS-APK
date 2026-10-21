"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { OBSERVATION_TYPES } from "@/lib/constants";
import { saveMonitoringRecord } from "@/modules/monitoring/actions";

export interface MonitoringInitial {
  id: string;
  project_id: string;
  site_id?: string | null;
  observation_type: string;
  observation_date: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  value_basis: string;
  methodology: string | null;
  measurements: Record<string, string | number>;
}

/** Field data collection form. Built for phones: large inputs, device GPS and camera capture. */
export function MonitoringForm({
  projects,
  sites = [],
  defaultProjectId,
  maxDate,
  initial,
}: {
  projects: { id: string; name: string; code: string }[];
  /** Named sites of those projects; choosing one ties the observation to that place. */
  sites?: { id: string; project_id: string; name: string; latitude: number; longitude: number }[];
  defaultProjectId?: string;
  maxDate: string;
  initial?: MonitoringInitial;
}) {
  const [type, setType] = useState(initial?.observation_type ?? "tree_planting");
  const [projectId, setProjectId] = useState(initial?.project_id ?? defaultProjectId ?? "");
  const [siteId, setSiteId] = useState(initial?.site_id ?? "");
  const projectSites = sites.filter((s) => s.project_id === projectId);
  const [coords, setCoords] = useState({
    latitude: initial?.latitude?.toString() ?? "",
    longitude: initial?.longitude?.toString() ?? "",
  });
  const [gps, setGps] = useState<{ state: "idle" | "locating" | "done" | "error"; message?: string }>({ state: "idle" });

  function captureLocation() {
    if (!("geolocation" in navigator)) {
      setGps({ state: "error", message: "This device does not provide a location. Enter the coordinates manually." });
      return;
    }
    setGps({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) });
        setGps({ state: "done", message: `Location captured (accuracy about ${Math.round(position.coords.accuracy)} m).` });
      },
      () => setGps({ state: "error", message: "Location could not be read. Allow location access or enter the coordinates manually." }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const fields = OBSERVATION_TYPES[type]?.fields ?? [];

  return (
    <ActionForm action={saveMonitoringRecord} submitLabel={initial ? "Save and resubmit for review" : "Submit field report"} className="space-y-5" resetOnSuccess={false}>
      {initial && <input type="hidden" name="record_id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Project">
          {initial ? (
            <>
              <input type="hidden" name="project_id" value={initial.project_id} />
              <input className="input" disabled value={projects.find((p) => p.id === initial.project_id)?.name ?? ""} readOnly />
            </>
          ) : (
            <select
              name="project_id"
              className="input"
              required
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSiteId("");
              }}
            >
              <option value="" disabled>Select a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Observation type">
          <select name="observation_type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(OBSERVATION_TYPES).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Observation date">
          <input name="observation_date" type="date" className="input" required max={maxDate} defaultValue={initial?.observation_date ?? maxDate} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="section-title">Location (GPS)</legend>
        {projectSites.length > 0 && (
          <Field label="Project site (optional)" hint="Choosing a site fills in its coordinates when none are entered. Use your current location for the exact spot.">
            <select
              name="site_id"
              className="input sm:max-w-sm"
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                const site = projectSites.find((s) => s.id === e.target.value);
                if (site && !coords.latitude && !coords.longitude) setCoords({ latitude: String(site.latitude), longitude: String(site.longitude) });
              }}
            >
              <option value="">Not at a named site</option>
              {projectSites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitude">
            <input
              name="latitude"
              type="number"
              step="0.000001"
              min="-90"
              max="90"
              inputMode="decimal"
              className="input"
              value={coords.latitude}
              onChange={(e) => setCoords({ ...coords, latitude: e.target.value })}
            />
          </Field>
          <Field label="Longitude">
            <input
              name="longitude"
              type="number"
              step="0.000001"
              min="-180"
              max="180"
              inputMode="decimal"
              className="input"
              value={coords.longitude}
              onChange={(e) => setCoords({ ...coords, longitude: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <button type="button" className="btn btn-secondary w-full" onClick={captureLocation} disabled={gps.state === "locating"}>
              {gps.state === "locating" ? "Locating…" : "Use my current location"}
            </button>
          </div>
        </div>
        {gps.message && <p className={`text-xs ${gps.state === "error" ? "text-red-300" : "text-muted-grey"}`}>{gps.message}</p>}
      </fieldset>

      {fields.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="section-title">Measurements</legend>
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
                  defaultValue={initial?.observation_type === type ? (initial.measurements[field.key] ?? "") : ""}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Basis of the figures" hint="Say whether values were measured on site or estimated.">
          <select name="value_basis" className="input" defaultValue={initial?.value_basis ?? "measured"}>
            <option value="measured">Measured in the field</option>
            <option value="estimated">Estimated</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Method (optional)" hint="How the measurement or estimate was made, e.g. sample plot size, instrument used.">
            <input name="methodology" className="input" maxLength={1000} defaultValue={initial?.methodology ?? ""} />
          </Field>
        </div>
      </div>

      <Field label="Observations and description" hint="At least 10 characters.">
        <textarea name="description" className="input" rows={5} required minLength={10} maxLength={5000} defaultValue={initial?.description ?? ""} />
      </Field>

      <Field label={initial ? "Add photographs (optional)" : "Photographs (optional)"} hint="Up to 3 images (JPG, PNG or WEBP), 10 MB each.">
        <input name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="input" />
      </Field>
    </ActionForm>
  );
}
