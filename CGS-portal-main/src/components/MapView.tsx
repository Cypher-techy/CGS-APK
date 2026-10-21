"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Feature } from "geojson";
import type { LatLng, Layer, LayerGroup, Map as LeafletMap, Polygon, TileLayerOptions } from "leaflet";
import { ActionForm } from "@/components/ActionForm";
import { saveBoundary } from "@/modules/gis/actions";
import { LAND_COVER_CLASSES, LAND_COVER_SERVICE, yearRange } from "@/modules/gis/landcover";

const KENYA: [number, number] = [0.2, 37.9];
const COLORS = { boundary: "#216b45", project: "#123c2b", observation: "#b45309", draft: "#1d4ed8" };

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function popup(feature: Feature): string {
  const p = feature.properties ?? {};
  if (p.kind === "boundary") {
    return `<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.code)}<br>Mapped boundary: ${escapeHtml(p.area_ha)} ha<br><a href="/dashboard/projects/${escapeHtml(p.project_id)}?tab=map">Open project map</a>`;
  }
  if (p.kind === "project") {
    return `<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.code)} · ${escapeHtml(p.county)}<br>Project location (declared)<br><a href="/dashboard/projects/${escapeHtml(p.project_id)}">Open project</a>`;
  }
  return `<strong>${escapeHtml(String(p.observation_type ?? "").replace(/_/g, " "))}</strong><br>${escapeHtml(p.code)} · ${escapeHtml(p.observation_date)}<br>${escapeHtml(p.value_basis)} · ${escapeHtml(String(p.review_status ?? "").replace(/_/g, " "))}<br><a href="/dashboard/monitoring/${escapeHtml(p.record_id)}">Open field report</a>`;
}

/**
 * Interactive map of project boundaries, project locations and monitoring observations.
 * With `drawProjectId` the user can also draw a boundary by clicking its corners.
 */
export function MapView({
  features,
  drawProjectId,
  landCoverYear,
  height = 480,
}: {
  features: FeatureCollection;
  drawProjectId?: string;
  /** Adds a land-cover overlay (Sentinel-2 10 m classification) for this year. */
  landCoverYear?: number;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const draftRef = useRef<{ layer: LayerGroup; shape: Polygon | null } | null>(null);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);

  useEffect(() => {
    drawingRef.current = drawing;
    if (container.current) container.current.style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);

  // Build the map once per feature set. Leaflet is loaded in the browser only.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !container.current) return;
      map = L.map(container.current, { scrollWheelZoom: false }).setView(KENYA, 6);
      mapRef.current = map;

      // Tiles stop at their native zoom; beyond it they are enlarged, so the view can close in to a 5 m scale.
      const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: 19,
        maxZoom: 21,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxNativeZoom: 18,
        maxZoom: 21,
        attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      });

      const pick = (kind: string) => ({ type: "FeatureCollection", features: features.features.filter((f) => f.properties?.kind === kind) }) as FeatureCollection;
      const boundaries = L.geoJSON(pick("boundary"), {
        style: { color: COLORS.boundary, weight: 2, fillColor: COLORS.boundary, fillOpacity: 0.15 },
        onEachFeature: (feature, layer) => layer.bindPopup(popup(feature)),
      }).addTo(map);
      const marker = (color: string, radius: number) => (feature: Feature, latlng: LatLng) =>
        L.circleMarker(latlng, { radius, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(popup(feature));
      const projects = L.geoJSON(pick("project"), { pointToLayer: marker(COLORS.project, 8) }).addTo(map);
      const observations = L.geoJSON(pick("observation"), { pointToLayer: marker(COLORS.observation, 6) }).addTo(map);

      const overlays: Record<string, Layer> = {
        "Project boundaries": boundaries,
        "Project locations": projects,
        "Monitoring observations": observations,
      };
      if (landCoverYear) {
        // The image service is not tiled, so each map tile requests its own bounding box (Web Mercator).
        const WORLD = 20037508.342789244;
        const bbox = (tile: { x: number; y: number; z: number }) => {
          const size = (2 * WORLD) / 2 ** tile.z;
          const xmin = -WORLD + tile.x * size;
          const ymax = WORLD - tile.y * size;
          return `${xmin},${ymax - size},${xmin + size},${ymax}`;
        };
        overlays[`Land cover ${landCoverYear} (Sentinel-2, 10 m)`] = L.tileLayer(
          `${LAND_COVER_SERVICE}/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&time=${yearRange(landCoverYear)}&f=image`,
          { bbox, opacity: 0.7, minZoom: 9, maxZoom: 21, attribution: "Land cover &copy; Impact Observatory, Microsoft, Esri" } as TileLayerOptions,
        );
      }
      L.control.layers({ "Street map": streets, "Satellite imagery": satellite }, overlays, { collapsed: false }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);

      const bounds = L.featureGroup([boundaries, projects, observations]).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 15 });

      const draft = L.layerGroup().addTo(map);
      draftRef.current = { layer: draft, shape: null };
      map.on("click", (event) => {
        if (drawingRef.current) setPoints((current) => [...current, event.latlng]);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      draftRef.current = null;
    };
  }, [features, landCoverYear]);

  // Redraw the boundary being drawn.
  useEffect(() => {
    const draft = draftRef.current;
    if (!draft) return;
    (async () => {
      const L = (await import("leaflet")).default;
      draft.layer.clearLayers();
      if (points.length === 0) return;
      L.polygon(points, { color: COLORS.draft, weight: 2, dashArray: "6 4", fillOpacity: 0.1 }).addTo(draft.layer);
      points.forEach((point) => L.circleMarker(point, { radius: 4, color: COLORS.draft, fillOpacity: 1 }).addTo(draft.layer));
    })();
  }, [points]);

  const drawn =
    points.length >= 3
      ? JSON.stringify({ type: "Polygon", coordinates: [[...points, points[0]].map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))])] })
      : "";

  return (
    <div>
      <div ref={container} style={{ height }} className="z-0 w-full rounded-md border border-subtle-border" role="application" aria-label="Project map" />
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-grey" aria-label="Map legend">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 border-2" style={{ borderColor: COLORS.boundary, background: "rgba(33,107,69,0.15)" }} /> Mapped project boundary
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLORS.project }} /> Project location (declared coordinates)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS.observation }} /> Monitoring observation
        </li>
      </ul>
      {landCoverYear && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-grey" aria-label="Land-cover legend">
          <li className="font-medium text-charcoal">Land cover {landCoverYear} (switch the layer on in the map; zoom in to see it):</li>
          {LAND_COVER_CLASSES.filter((c) => c.key !== "snow_ice").map((c) => (
            <li key={c.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 border border-subtle-border" style={{ background: c.color }} /> {c.label}
            </li>
          ))}
        </ul>
      )}

      {drawProjectId && (
        <div className="mt-4 rounded-md border border-subtle-border p-3">
          <p className="text-sm font-medium text-charcoal">Draw the boundary on the map</p>
          <p className="mt-0.5 text-xs text-muted-grey">
            Switch to satellite imagery, start drawing, then click each corner of the parcel in order. Saving replaces the existing boundary.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={`btn btn-sm ${drawing ? "btn-primary" : "btn-secondary"}`} aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>
              {drawing ? "Stop drawing" : "Start drawing"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={points.length === 0} onClick={() => setPoints(points.slice(0, -1))}>
              Undo last point
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={points.length === 0} onClick={() => setPoints([])}>
              Clear
            </button>
            <span className="text-xs text-muted-grey">{points.length} point{points.length === 1 ? "" : "s"}</span>
          </div>
          {drawn && (
            <ActionForm action={saveBoundary} submitLabel="Save drawn boundary" className="mt-3">
              <input type="hidden" name="project_id" value={drawProjectId} />
              <input type="hidden" name="geojson" value={drawn} />
              <input type="hidden" name="source" value="Drawn on map in the portal" />
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
