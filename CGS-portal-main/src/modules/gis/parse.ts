import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import shp from "shpjs";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Reads a boundary file into GeoJSON. Supported: GeoJSON, KML, and a zipped shapefile
 * (.shp with its .dbf and, for anything other than WGS 84, its .prj). Geometry is validated later by PostGIS.
 */
export async function readBoundaryFile(file: File): Promise<{ geojson: unknown; error: null } | { geojson: null; error: string }> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_BYTES) return { geojson: null, error: "The file is larger than 5 MB. Simplify the boundary and try again." };

  try {
    if (name.endsWith(".geojson") || name.endsWith(".json")) {
      return { geojson: JSON.parse(await file.text()), error: null };
    }
    if (name.endsWith(".kml")) {
      const document = new DOMParser().parseFromString(await file.text(), "text/xml");
      const collection = kml(document as unknown as Document);
      if (!collection.features.length) return { geojson: null, error: "No placemarks were found in the KML file." };
      return { geojson: collection, error: null };
    }
    if (name.endsWith(".zip")) {
      const parsed = (await shp(await file.arrayBuffer())) as unknown;
      // A zip with several shapefiles yields several collections: merge their features.
      const collections = (Array.isArray(parsed) ? parsed : [parsed]) as { features?: unknown[] }[];
      const features = collections.flatMap((c) => c.features ?? []);
      if (!features.length) return { geojson: null, error: "No shapes were found in the zipped shapefile." };
      return { geojson: { type: "FeatureCollection", features }, error: null };
    }
  } catch {
    return { geojson: null, error: "The file could not be read. Check that it is a valid GeoJSON, KML or zipped shapefile." };
  }
  return { geojson: null, error: "Unsupported file type. Upload GeoJSON (.geojson), KML (.kml) or a zipped shapefile (.zip). KMZ files must be unzipped first." };
}
