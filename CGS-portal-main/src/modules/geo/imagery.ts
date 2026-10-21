import type maplibregl from "maplibre-gl";

/**
 * Satellite imagery at the best resolution each place has.
 *
 * Esri's World Imagery goes one level deeper in towns (zoom 19) than in the countryside (zoom 18, in remote
 * areas 17). Asking for a level that does not exist normally returns a grey "not yet available" picture, so
 * the map used to stop at zoom 18 everywhere. This protocol asks for the deep tile with `blankTile=false`,
 * which makes the service answer 404 when it has none, and then cuts the same square out of the nearest
 * shallower tile that does exist. The result is the sharpest picture available at every place.
 */
const SERVICE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
export const IMAGERY_TILES = "esri-imagery://{z}/{y}/{x}";
export const IMAGERY_MAXZOOM = 19;
// Imagery exists everywhere down to this zoom, so nothing shallower is ever checked.
const ALWAYS = 16;
const missing = new Set<string>();
let registered = false;

/** A tile is known to be missing when it, or a shallower tile covering it, has already answered 404. */
function knownMissing(z: number, x: number, y: number): boolean {
  for (let up = 0; z - up > ALWAYS; up++) if (missing.has(`${z - up}/${x >> up}/${y >> up}`)) return true;
  return false;
}

async function enlarge(source: Blob, column: number, row: number, parts: number): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const size = bitmap.width / parts;
  context.drawImage(bitmap, column * size, row * size, size, size, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Imagery tile could not be drawn");
  return blob.arrayBuffer();
}

export function registerImagery(lib: typeof maplibregl) {
  if (registered) return;
  registered = true;
  lib.addProtocol("esri-imagery", async (request, abort) => {
    const [z, y, x] = request.url.slice("esri-imagery://".length).split("/").map(Number);
    for (let up = 0; z - up >= 0; up++) {
      const level = z - up, column = x >> up, row = y >> up;
      if (level > ALWAYS && knownMissing(level, column, row)) continue;
      const response = await fetch(`${SERVICE}/${level}/${row}/${column}${level > ALWAYS ? "?blankTile=false" : ""}`, { signal: abort.signal });
      if (response.status === 404 && level > ALWAYS) {
        if (missing.size > 20000) missing.clear();
        missing.add(`${level}/${column}/${row}`);
        continue;
      }
      if (!response.ok) throw new Error(`Imagery tile failed (${response.status})`);
      if (up === 0) return { data: await response.arrayBuffer() };
      return { data: await enlarge(await response.blob(), x - (column << up), y - (row << up), 2 ** up) };
    }
    throw new Error("No imagery for this tile");
  });
}
