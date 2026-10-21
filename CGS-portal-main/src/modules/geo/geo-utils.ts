import type { Feature, FeatureCollection, Geometry, Point, Position } from "geojson";


export type Props = Record<string, any>;
export type Bounds = [number, number, number, number];

/** Where the viewer is: Earth / continent / country / county / project / site. */
export interface GeoPath {
  continent: string | null;
  /** ISO 3166-1 alpha-2 code. */
  country: string | null;
  county: string | null;
  project: string | null;
  site: string | null;
}
/** Longitude / latitude of a point feature. */
export const lngLatOf = (geometry: Geometry): [number, number] => (geometry as Point).coordinates as [number, number];

export const EARTH: GeoPath = { continent: null, country: null, county: null, project: null, site: null };

const ORDER = ["continent", "country", "county", "project", "site"] as const;

/** "Africa/KE/Nakuru/<project id>" — kept in the URL so a location can be shared and restored. */
export function encodePath(path: GeoPath): string {
  const parts = ORDER.map((key) => path[key] ?? "");
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.map((part) => encodeURIComponent(part || "-")).join("/");
}

export function decodePath(value: string | null | undefined): GeoPath {
  const path: GeoPath = { ...EARTH };
  if (!value) return path;
  value
    .split("/")
    .slice(0, ORDER.length)
    .forEach((raw, i) => {
      let part = raw;
      try {
        part = decodeURIComponent(raw);
      } catch {}
      if (part && part !== "-") path[ORDER[i]] = part.slice(0, 80);
    });
  return path;
}

/** Deepest level that is set. */
export function levelOf(path: GeoPath): "earth" | (typeof ORDER)[number] {
  for (let i = ORDER.length - 1; i >= 0; i--) if (path[ORDER[i]]) return ORDER[i];
  return "earth";
}

/** One level up, keeping everything above it. */
export function parentOf(path: GeoPath): GeoPath {
  const next = { ...path };
  for (let i = ORDER.length - 1; i >= 0; i--) {
    if (next[ORDER[i]]) {
      next[ORDER[i]] = null;
      break;
    }
  }
  return next;
}

/** Compares place names loosely: "Nakuru County", "nakuru" and "NAKURU " are the same county. */
export const placeKey = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\bcounty\b/g, "")
    .replace(/[^a-z]/g, "");

function eachRing(geometry: Geometry, visit: (ring: Position[], polygon: number) => void) {
  if (geometry.type === "Polygon") geometry.coordinates.forEach((ring) => visit(ring, 0));
  else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon, i) => polygon.forEach((ring) => visit(ring, i)));
}

export function boundsOf(geometry: Geometry): Bounds | null {
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates;
    return [x, y, x, y];
  }
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  eachRing(geometry, (ring) => {
    for (const [x, y] of ring) {
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
  });
  return Number.isFinite(box[0]) ? box : null;
}

/**
 * Bounds of the largest part of a country, so that distant territories
 * (and parts across the antimeridian) do not pull the camera away from the mainland.
 */
export function mainlandBounds(geometry: Geometry): Bounds | null {
  if (geometry.type !== "MultiPolygon") return boundsOf(geometry);
  let best: Bounds | null = null;
  let bestSize = -1;
  for (const polygon of geometry.coordinates) {
    const box = boundsOf({ type: "Polygon", coordinates: polygon });
    if (!box) continue;
    const size = (box[2] - box[0]) * (box[3] - box[1]);
    if (size > bestSize) {
      best = box;
      bestSize = size;
    }
  }
  return best;
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry([x, y]: Position, geometry: Geometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole)));
}

/** Camera frames per continent (the country dataset has no continent outlines). */
export const CONTINENT_BOUNDS: Record<string, Bounds> = {
  Africa: [-19, -36, 52, 38],
  Asia: [26, -10, 146, 56],
  Europe: [-12, 35, 42, 70],
  "North America": [-135, 8, -55, 62],
  "South America": [-82, -56, -34, 13],
  Oceania: [110, -47, 180, 0],
};

export interface ProjectPlace {
  id: string;
  props: Props;
  lngLat: [number, number];
  iso2: string | null;
  countryName: string;
  continent: string | null;
  /** County as shown to the viewer; matched to the official county list where possible. */
  county: string;
}

/**
 * Places every project in the geographic hierarchy.
 * Country comes from the declared country name. The county or region is matched by name against the
 * official outlines of that country; where the declared name is unknown the project point is located
 * inside the outlines instead.
 */
export function placeProjects(features: FeatureCollection, countries: FeatureCollection | null, counties: FeatureCollection | null): ProjectPlace[] {
  const byName = new Map<string, Props>();
  countries?.features.forEach((f) => byName.set(placeKey(f.properties?.name), f.properties ?? {}));
  // Regions are matched within their own country, so equal names in two countries never collide.
  const regionNames = new Map<string, string>();
  counties?.features.forEach((f) => regionNames.set(`${f.properties?.country}:${placeKey(f.properties?.name)}`, f.properties?.name));

  return features.features
    .filter((f) => f.properties?.kind === "project" && f.geometry?.type === "Point")
    .map((f) => {
      const props = f.properties ?? {};
      const lngLat = lngLatOf(f.geometry);
      const country = byName.get(placeKey(props.country));
      let county = regionNames.get(`${country?.iso2}:${placeKey(props.county)}`) ?? null;
      if (!county && counties && country?.iso2) {
        county = counties.features.find((c) => c.properties?.country === country.iso2 && pointInGeometry(lngLat, c.geometry))?.properties?.name ?? null;
      }
      return {
        id: String(props.project_id),
        props,
        lngLat,
        iso2: country?.iso2 ?? null,
        countryName: country?.name ?? String(props.country ?? "Unspecified country"),
        continent: country?.continent ?? null,
        county: county ?? String(props.county ?? "Unspecified"),
      };
    });
}

export function inPath(place: ProjectPlace, path: GeoPath): boolean {
  if (path.project) return place.id === path.project;
  if (path.continent && place.continent !== path.continent) return false;
  if (path.country && place.iso2 !== path.country) return false;
  if (path.county && placeKey(place.county) !== placeKey(path.county)) return false;
  return true;
}

export const featuresOfKind = (collection: FeatureCollection, kind: string): Feature[] =>
  collection.features.filter((f) => f.properties?.kind === kind);

export function countBy<T>(items: T[], key: (item: T) => string | null | undefined): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
