/**
 * Registry of map layers. Each entry states where its data comes from and how far it can be trusted,
 * so the legend never presents declared, derived or third-party data as verified fact.
 *
 * To connect a new environmental dataset: add its tile service to BASEMAPS / EarthExplorer and
 * switch `available` on here. Layers without a connected dataset stay listed as unavailable.
 */
import { IMAGERY_MAXZOOM, IMAGERY_TILES } from "@/modules/geo/imagery";

export type DataClass = "reference" | "declared" | "derived" | "field" | "third_party";

export const DATA_CLASS: Record<DataClass, { label: string; hint: string }> = {
  reference: { label: "Reference", hint: "Published base data from a named source." },
  declared: { label: "User-submitted", hint: "Entered by the project owner. Not independently checked." },
  derived: { label: "Derived", hint: "Calculated by CGS from stored geometry." },
  field: { label: "Field record", hint: "Recorded by a field officer; marked measured or estimated." },
  third_party: { label: "Third-party estimate", hint: "Modelled by an external provider. Not ground-truthed by CGS." },
};

export interface OverlayDef {
  id: string;
  label: string;
  dataClass: DataClass;
  source: string;
  available: boolean;
  /** Shown in place of the toggle when the dataset is not connected. */
  note?: string;
  defaultOn?: boolean;
  swatch: string;
  shape: "dot" | "area" | "line";
}

export const OVERLAYS: OverlayDef[] = [
  { id: "projects", label: "Project locations", dataClass: "declared", source: "CGS project register", available: true, defaultOn: true, swatch: "#2e7d52", shape: "dot" },
  { id: "boundaries", label: "Project boundaries", dataClass: "derived", source: "CGS PostGIS boundaries (area calculated)", available: true, defaultOn: true, swatch: "#216b45", shape: "area" },
  { id: "sites", label: "Project sites", dataClass: "declared", source: "CGS project register", available: true, defaultOn: true, swatch: "#1f5f78", shape: "dot" },
  { id: "observations", label: "Field observations", dataClass: "field", source: "CGS monitoring records", available: true, defaultOn: true, swatch: "#c0672f", shape: "dot" },
  { id: "countries", label: "Country borders", dataClass: "reference", source: "Natural Earth 1:110m", available: true, defaultOn: true, swatch: "#e8efe6", shape: "line" },
  { id: "counties", label: "Counties, regions, districts and sub-counties", dataClass: "reference", source: "geoBoundaries ADM1 and ADM2 (Kenya counties: RCMRD)", available: true, defaultOn: true, swatch: "#a7bfa9", shape: "line" },
  { id: "places", label: "Place names (towns, villages, settlements)", dataClass: "reference", source: "OpenStreetMap via OpenFreeMap", available: true, defaultOn: true, swatch: "#f6f2e8", shape: "dot" },
  { id: "landcover", label: "Land cover (10 m)", dataClass: "third_party", source: "Sentinel-2 LULC, Impact Observatory / Esri", available: true, swatch: "#397d49", shape: "area" },
  { id: "protected", label: "Protected areas", dataClass: "reference", source: "WDPA, UNEP-WCMC and IUCN", available: true, swatch: "#38a800", shape: "area" },
  { id: "forest", label: "Forest cover change", dataClass: "third_party", source: "Not connected", available: false, note: "Environmental layer unavailable", swatch: "#8a8f8b", shape: "area" },
];

/** World Database on Protected Areas (UNEP-WCMC and IUCN). Check its terms of use before commercial use. */
/** Place names worldwide, down to villages and isolated settlements (OpenStreetMap, served free by OpenFreeMap). */
export const PLACE_NAMES_TILES = "https://tiles.openfreemap.org/planet";

export const PROTECTED_AREAS_SERVICE = "https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer";

export const BASEMAPS = [
  {
    id: "satellite",
    label: "Satellite",
    // Served through the "esri-imagery" protocol (imagery.ts), which finds the sharpest tile each place has.
    tiles: IMAGERY_TILES,
    maxzoom: IMAGERY_MAXZOOM,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "light",
    label: "Light",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 16,
    attribution: "Basemap © Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  {
    id: "streets",
    label: "Streets",
    tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors",
  },
] as const;
export type BasemapId = (typeof BASEMAPS)[number]["id"];

/** Marker colour per project status. */
export const STATUS_COLORS: Record<string, string> = {
  active: "#4cc38a",
  completed: "#1f8f63",
  approved: "#4f8f8b",
  on_hold: "#7a857e",
  pending_approval: "#c98a2b",
  revision_required: "#c98a2b",
  draft: "#b9a37a",
  rejected: "#b4553a",
};
