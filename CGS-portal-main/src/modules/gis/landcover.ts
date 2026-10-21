/**
 * Land-cover statistics from the "Sentinel-2 10m Land Use/Land Cover Time Series"
 * (Impact Observatory, Microsoft and Esri; annual maps from 2017, CC BY 4.0).
 * This is a third-party, model-based classification. It has not been ground-truthed by CGS.
 */
export const LAND_COVER_SERVICE = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer";
export const LAND_COVER_SOURCE = "Sentinel-2 10m Land Use/Land Cover (Impact Observatory, Microsoft, Esri)";
export const LAND_COVER_FIRST_YEAR = 2017;

/** Pixel values of the service, with the colours it renders them in. */
export const LAND_COVER_CLASSES: { value: number; key: string; label: string; color: string }[] = [
  { value: 2, key: "trees", label: "Trees", color: "#358221" },
  { value: 11, key: "rangeland", label: "Rangeland", color: "#efcfa8" },
  { value: 5, key: "crops", label: "Crops", color: "#ffdb5c" },
  { value: 4, key: "flooded_vegetation", label: "Flooded vegetation", color: "#87d19e" },
  { value: 1, key: "water", label: "Water", color: "#1a5bab" },
  { value: 7, key: "built_area", label: "Built area", color: "#ed022a" },
  { value: 8, key: "bare_ground", label: "Bare ground", color: "#ede9e4" },
  { value: 9, key: "snow_ice", label: "Snow / ice", color: "#f2faff" },
  { value: 10, key: "clouds", label: "Clouds (no data)", color: "#c8c8c8" },
];

export const yearRange = (year: number) => `${Date.UTC(year, 0, 1)},${Date.UTC(year + 1, 0, 1) - 1}`;

type Ring = [number, number][];

/** Signed area: positive when the ring runs counter-clockwise. */
const signedArea = (ring: Ring) =>
  ring.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = ring[(i + 1) % ring.length];
    return sum + (x * nextY - nextX * y);
  }, 0) / 2;

/** Converts a GeoJSON MultiPolygon to Esri rings (outer rings clockwise, holes counter-clockwise). */
export function toEsriPolygon(coordinates: Ring[][]) {
  const rings: Ring[] = [];
  for (const polygon of coordinates) {
    polygon.forEach((ring, index) => {
      const counterClockwise = signedArea(ring) > 0;
      const wantCounterClockwise = index > 0;
      rings.push(counterClockwise === wantCounterClockwise ? ring : [...ring].reverse());
    });
  }
  return { rings, spatialReference: { wkid: 4326 } };
}

/**
 * Hectares per land-cover class inside a boundary for one year. Pixel counts from the service are
 * converted to area by their share of the boundary area calculated by PostGIS.
 */
export async function landCoverByClass(coordinates: Ring[][], year: number, boundaryAreaHa: number): Promise<Record<string, number>> {
  const body = new URLSearchParams({
    geometry: JSON.stringify(toEsriPolygon(coordinates)),
    geometryType: "esriGeometryPolygon",
    time: yearRange(year),
    pixelSize: JSON.stringify({ x: 10, y: 10, spatialReference: { wkid: 3857 } }),
    f: "json",
  });
  const response = await fetch(`${LAND_COVER_SERVICE}/computeHistograms`, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Land-cover service responded with ${response.status}`);
  const result = (await response.json()) as { histograms?: { counts: number[] }[]; error?: { message: string } };
  if (result.error) throw new Error(result.error.message);
  const counts = result.histograms?.[0]?.counts ?? [];
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) throw new Error("NO_DATA");

  const classes: Record<string, number> = {};
  for (const item of LAND_COVER_CLASSES) {
    const pixels = counts[item.value] ?? 0;
    if (pixels > 0) classes[item.key] = Number(((pixels / total) * boundaryAreaHa).toFixed(2));
  }
  return classes;
}
