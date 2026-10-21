"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { Field } from "@/components/ui";
import { boundsOf, placeKey } from "@/modules/geo/geo-utils";
import { BASEMAPS } from "@/modules/geo/layers";
import { COUNTRIES, KENYA_COUNTIES } from "@/modules/geo/places";
import { BOUNDARY_FILE_TYPES } from "@/modules/gis/parse-types";

type Mode = "point" | "boundary";
type Point = [number, number];

const AFRICA = COUNTRIES.filter((c) => c.continent === "Africa");
const ELSEWHERE = COUNTRIES.filter((c) => c.continent !== "Africa");
const collection = (features: FeatureCollection["features"]): FeatureCollection => ({ type: "FeatureCollection", features });

/**
 * Geographic part of the project form: country, county, coordinates and boundary.
 * The location can be typed, picked on the map, drawn as a polygon or uploaded as a GIS file.
 */
export function ProjectGeoFields({
  initial,
  allowBoundary,
}: {
  initial?: { country?: string; county?: string; sub_county?: string | null; latitude?: number | null; longitude?: number | null; area_ha?: number | null; location_description?: string | null };
  /** Boundary drawing and upload; off when the viewer may not change the boundary in the current status. */
  allowBoundary: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [country, setCountry] = useState(initial?.country ?? "Kenya");
  const [county, setCounty] = useState(initial?.county ?? "");
  const [lat, setLat] = useState(initial?.latitude?.toString() ?? "");
  const [lng, setLng] = useState(initial?.longitude?.toString() ?? "");
  const [mode, setMode] = useState<Mode>("point");
  const [ring, setRing] = useState<Point[]>([]);
  const [satellite, setSatellite] = useState(true);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !container.current) return;
      const start: Point | null = initial?.latitude != null && initial?.longitude != null ? [Number(initial.longitude), Number(initial.latitude)] : null;
      map = new maplibregl.Map({
        container: container.current,
        center: start ?? [37.9, 0.2],
        zoom: start ? 11 : 5,
        cooperativeGestures: true,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: Object.fromEntries(BASEMAPS.map((b) => [b.id, { type: "raster", tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution }])),
          layers: [
            { id: "base-satellite", type: "raster", source: "satellite" },
            { id: "base-streets", type: "raster", source: "streets", layout: { visibility: "none" } },
          ],
        },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        if (!map || cancelled) return;
        map.addSource("pin", { type: "geojson", data: collection([]) });
        map.addSource("draft", { type: "geojson", data: collection([]) });
        map.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#5fb37f", "fill-opacity": 0.25 } });
        map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": "#f6f2e8", "line-width": 2, "line-dasharray": [2, 1.5] } });
        map.addLayer({ id: "draft-pt", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#f6f2e8", "circle-stroke-color": "#123c2b", "circle-stroke-width": 1.5 } });
        map.addLayer({ id: "pin", type: "circle", source: "pin", paint: { "circle-radius": 8, "circle-color": "#c2603c", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
        map.on("click", (event) => {
          const point: Point = [Number(event.lngLat.lng.toFixed(6)), Number(event.lngLat.lat.toFixed(6))];
          if (modeRef.current === "boundary") setRing((current) => [...current, point]);
          else {
            setLng(String(point[0]));
            setLat(String(point[1]));
          }
        });
        map.getCanvas().style.cursor = "crosshair";
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The map is created once; later changes to the fields are pushed to it by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fields → map.
  useEffect(() => {
    if (!ready) return;
    const x = Number(lng);
    const y = Number(lat);
    const valid = lat !== "" && lng !== "" && Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 90 && Math.abs(x) <= 180;
    (mapRef.current?.getSource("pin") as GeoJSONSource | undefined)?.setData(
      collection(valid ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [x, y] } }] : []),
    );
  }, [ready, lat, lng]);

  useEffect(() => {
    if (!ready) return;
    const features: FeatureCollection["features"] = ring.map((point) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point } }));
    if (ring.length >= 3) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
    else if (ring.length === 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } });
    (mapRef.current?.getSource("draft") as GeoJSONSource | undefined)?.setData(collection(features));
  }, [ready, ring]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("base-satellite", "visibility", satellite ? "visible" : "none");
    map.setLayoutProperty("base-streets", "visibility", satellite ? "none" : "visible");
  }, [ready, satellite]);

  // Choosing a Kenyan county moves the map there, so the location can be picked without hunting for it.
  async function focusCounty(name: string) {
    if (placeKey(country) !== "kenya" || !KENYA_COUNTIES.some((c) => placeKey(c) === placeKey(name))) return;
    try {
      const data: FeatureCollection = await (await fetch("/geo/kenya-counties.json")).json();
      const feature = data.features.find((f) => placeKey(f.properties?.name) === placeKey(name));
      const box = feature && boundsOf(feature.geometry);
      if (box) mapRef.current?.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 30, duration: 900 });
    } catch {}
  }

  const drawn = ring.length >= 3 ? JSON.stringify({ type: "Polygon", coordinates: [[...ring, ring[0]]] }) : "";
  const isKenya = placeKey(country) === "kenya";

  return (
    <fieldset className="space-y-4">
      <legend className="section-title">Location</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Country">
          <select name="country" className="input" required value={country} onChange={(event) => setCountry(event.target.value)}>
            <optgroup label="Africa">
              {AFRICA.map((c) => (
                <option key={c.iso2} value={c.name}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Rest of the world">
              {ELSEWHERE.map((c) => (
                <option key={c.iso2} value={c.name}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label={isKenya ? "County" : "County, state or region"}>
          <input
            name="county"
            className="input"
            required
            minLength={2}
            maxLength={80}
            list={isKenya ? "kenya-counties" : undefined}
            value={county}
            onChange={(event) => {
              setCounty(event.target.value);
              focusCounty(event.target.value);
            }}
            autoComplete="off"
          />
          <datalist id="kenya-counties">
            {KENYA_COUNTIES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Sub-county (optional)">
          <input name="sub_county" className="input" maxLength={80} defaultValue={initial?.sub_county ?? ""} />
        </Field>
      </div>

      <div className="overflow-hidden rounded-2xl border border-subtle-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle-border bg-cream px-3 py-2 text-xs">
          <div className="flex rounded-full border border-subtle-border bg-surface p-0.5" role="group" aria-label="Map tool">
            <button type="button" aria-pressed={mode === "point"} onClick={() => setMode("point")} className={`rounded-full px-3 py-1 ${mode === "point" ? "bg-forest text-white" : "text-charcoal"}`}>
              Place location
            </button>
            {allowBoundary && (
              <button type="button" aria-pressed={mode === "boundary"} onClick={() => setMode("boundary")} className={`rounded-full px-3 py-1 ${mode === "boundary" ? "bg-forest text-white" : "text-charcoal"}`}>
                Draw boundary
              </button>
            )}
          </div>
          {mode === "boundary" && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={ring.length === 0} onClick={() => setRing(ring.slice(0, -1))}>Undo point</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={ring.length === 0} onClick={() => setRing([])}>Clear</button>
              <span className="text-muted-grey">{ring.length} corner{ring.length === 1 ? "" : "s"}{ring.length > 0 && ring.length < 3 ? " (at least 3)" : ""}</span>
            </>
          )}
          <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={() => setSatellite(!satellite)}>
            {satellite ? "Street map" : "Satellite"}
          </button>
        </div>
        <div ref={container} className="earth h-80 w-full" role="application" aria-label="Map for choosing the project location" />
        <p className="bg-cream px-3 py-2 text-xs text-muted-grey">
          {mode === "point"
            ? "Click the map to set the project location, or type the coordinates below."
            : "Click each corner of the project area in order. The area is calculated from the boundary when you save."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Latitude" hint="Decimal degrees, e.g. -1.2921">
          <input name="latitude" type="number" step="0.000001" min="-90" max="90" className="input" value={lat} onChange={(event) => setLat(event.target.value)} />
        </Field>
        <Field label="Longitude" hint="Decimal degrees, e.g. 36.8219">
          <input name="longitude" type="number" step="0.000001" min="-180" max="180" className="input" value={lng} onChange={(event) => setLng(event.target.value)} />
        </Field>
        <Field label="Declared land area (ha, optional)" hint="Your own figure. The mapped area is calculated separately.">
          <input name="area_ha" type="number" step="0.01" min="0" className="input" defaultValue={initial?.area_ha ?? ""} />
        </Field>
      </div>

      {allowBoundary && (
        <Field label="Or upload the boundary (optional)" hint="GeoJSON, KML, or a zipped shapefile (.shp, .dbf, .prj). Up to 5 MB. A drawn boundary takes precedence over an uploaded file.">
          <input name="boundary_file" type="file" accept={BOUNDARY_FILE_TYPES} className="input" />
        </Field>
      )}
      <input type="hidden" name="boundary_geojson" value={drawn} />

      <Field label="Location description (optional)" hint="Nearest town, ward or landmark.">
        <input name="location_description" className="input" maxLength={500} defaultValue={initial?.location_description ?? ""} />
      </Field>
    </fieldset>
  );
}
