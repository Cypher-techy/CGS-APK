import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { COUNTRIES } from "@/modules/geo/places";

/**
 * Administrative units of one country, for the Earth drill-down: first level (states, provinces, counties) by
 * default, second level (districts, sub-counties, municipalities) with ?level=2. A second-level request names
 * the area it wants with ?bbox=west,south,east,north and gets only the units centred inside it, because a whole
 * country's districts can be thousands of outlines.
 * The outlines come from geoBoundaries (gbOpen, ADM1 / ADM2), are trimmed to a name and rounded coordinates,
 * and are cached for a month. Kenya's counties ship with the app in public/geo; its sub-counties come from here.
 */
const API = "https://www.geoboundaries.org/api/current/gbOpen";
const MONTH = 60 * 60 * 24 * 30;
const MAX_BYTES = { 1: 12 * 1024 * 1024, 2: 48 * 1024 * 1024 };
const cache = new Map<string, FeatureCollection>();

// Districts are looked at more closely than regions, so they keep one more decimal (about 11 m).
let digits = 3;
const round = (position: Position): Position => [Number(position[0].toFixed(digits)), Number(position[1].toFixed(digits))];

/** Middle of a geometry's bounding box: enough to decide which region a district belongs to. */
function centre(geometry: Geometry): Position | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      west = Math.min(west, value[0]); east = Math.max(east, value[0]);
      south = Math.min(south, value[1]); north = Math.max(north, value[1]);
    } else value.forEach(visit);
  };
  visit((geometry as { coordinates?: unknown }).coordinates);
  return Number.isFinite(west) ? [(west + east) / 2, (south + north) / 2] : null;
}
const ring = (points: Position[]) => {
  const out = points.map(round).filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
  return out.length >= 4 ? out : null;
};
function simplify(geometry: Geometry): Geometry | null {
  const polygon = (rings: Position[][]) => rings.map(ring).filter((r): r is Position[] => r !== null);
  if (geometry.type === "Polygon") {
    const rings = polygon(geometry.coordinates);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates.map(polygon).filter((p) => p.length);
    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const { iso } = await params;
  const query = new URL(request.url).searchParams;
  const level = query.get("level") === "2" ? 2 : 1;
  const box = (query.get("bbox") ?? "").split(",").map(Number);
  if (level === 2 && (box.length !== 4 || box.some((n) => !Number.isFinite(n)))) return Response.json({ error: "A bounding box is required for districts" }, { status: 400 });
  /** For districts, only the units centred inside the requested box are returned. */
  const answer = (collection: FeatureCollection): FeatureCollection =>
    level === 1 ? collection : ({
      ...collection,
      features: collection.features.filter((f) => {
        const c = f.properties?.centre as Position | undefined;
        return !!c && c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3];
      }).slice(0, 1500),
    } as FeatureCollection);
  const country = COUNTRIES.find((c) => c.iso2 === iso.toUpperCase());
  if (!country) return Response.json({ error: "Unknown country" }, { status: 404 });
  const headers = { "Cache-Control": `public, max-age=86400, s-maxage=${MONTH}, stale-while-revalidate=${MONTH}` };
  const key = `${country.iso2}:${level}`;
  const cached = cache.get(key);
  if (cached) return Response.json(answer(cached), { headers });

  try {
    const meta = await fetch(`${API}/${country.iso3}/ADM${level}/`, { next: { revalidate: MONTH } });
    if (!meta.ok) return Response.json({ error: "No boundaries of this level are published for this country" }, { status: 404 });
    const info = (await meta.json()) as { simplifiedGeometryGeoJSON?: string; boundarySource?: string; boundaryLicense?: string };
    const url = info.simplifiedGeometryGeoJSON;
    // Only the dataset's own repository is fetched, whatever the metadata says.
    if (!url || !url.startsWith("https://github.com/wmgeolab/geoBoundaries/")) return Response.json({ error: "Boundary file unavailable" }, { status: 502 });
    const file = await fetch(url, { cache: "no-store" });
    if (!file.ok) return Response.json({ error: "Boundary file unavailable" }, { status: 502 });
    const text = await file.text();
    if (text.length > MAX_BYTES[level]) return Response.json({ error: "Boundary file too large" }, { status: 502 });
    const source = JSON.parse(text) as FeatureCollection;

    const features: Feature[] = [];
    digits = level === 2 ? 4 : 3;
    for (const feature of source.features ?? []) {
      const geometry = feature.geometry && simplify(feature.geometry);
      const name = String(feature.properties?.shapeName ?? "").trim().slice(0, 80);
      if (!geometry || !name) continue;
      const properties = level === 2 ? { name, country: country.iso2, centre: centre(geometry) } : { name, country: country.iso2 };
      features.push({ type: "Feature", id: features.length + 1, properties, geometry });
    }
    const collection = { type: "FeatureCollection", features, source: info.boundarySource ?? "geoBoundaries", license: info.boundaryLicense ?? null } as FeatureCollection;
    cache.set(key, collection);
    return Response.json(answer(collection), { headers });
  } catch (error) {
    console.error("Regional boundaries failed:", country.iso3, error);
    return Response.json({ error: "Regional boundaries are unavailable right now" }, { status: 502 });
  }
}
