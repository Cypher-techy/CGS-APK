"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Feature, FeatureCollection } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { ChevronLeft, Globe2, Layers, Map as MapIcon, Search, X } from "lucide-react";
import { reportEarthProgress } from "@/components/Motion";
import { LAND_COVER_SERVICE, yearRange } from "@/modules/gis/landcover";
import { ExplorerPanel, type ActivityEntry, type Insight } from "@/modules/geo/ExplorerPanel";
import {
  boundsOf,
  pointInGeometry,
  CONTINENT_BOUNDS,
  decodePath,
  EARTH,
  encodePath,
  featuresOfKind,
  inPath,
  levelOf,
  lngLatOf,
  mainlandBounds,
  parentOf,
  placeKey,
  placeProjects,
  type Bounds,
  type GeoPath,
  type Props,
} from "@/modules/geo/geo-utils";
import { BASEMAPS, DATA_CLASS, OVERLAYS, PLACE_NAMES_TILES, PROTECTED_AREAS_SERVICE, STATUS_COLORS, type BasemapId } from "@/modules/geo/layers";
import { registerImagery } from "@/modules/geo/imagery";

export type ExplorerMode = "explore" | "workspace" | "admin";
type Variant = "full" | "embedded" | "hero";

const STORE_KEY = "cgs-geo-context";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const LAND_COVER_YEAR = new Date().getUTCFullYear() - 1;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** MapLibre layers that belong to each overlay toggle. */
const OVERLAY_LAYERS: Record<string, string[]> = {
  projects: ["projects-cluster", "projects-count", "projects-pt", "projects-label", "projects-selected"],
  boundaries: ["boundaries-fill", "boundaries-line"],
  sites: ["sites-pt", "sites-label"],
  observations: ["obs-pt"],
  countries: ["countries-line"],
  counties: ["counties-fill", "counties-line", "counties-label", "districts-fill", "districts-line", "districts-label"],
  places: ["places-local", "places-village", "places-town"],
  landcover: ["landcover"],
  protected: ["protected"],
};

const STATUS_COLOR: ExpressionSpecification = [
  "match",
  ["get", "status"],
  ...Object.entries(STATUS_COLORS).flat(),
  "#7a857e",
] as unknown as ExpressionSpecification;

function baseStyle(basemap: BasemapId): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: "globe" },
    sky: {
      "sky-color": "#0c1a14",
      "horizon-color": "#c9d8cc",
      "fog-color": "#dfe8df",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.7, 5, 0.5, 7, 0],
    },
    sources: Object.fromEntries(
      BASEMAPS.map((b) => [b.id, { type: "raster", tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution }]),
    ),
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": "#16332a" } },
      ...BASEMAPS.map((b) => ({
        id: `base-${b.id}`,
        type: "raster" as const,
        source: b.id,
        layout: { visibility: b.id === basemap ? ("visible" as const) : ("none" as const) },
      })),
    ],
  };
}

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/**
 * The CGS Earth: one map engine that renders a 3D globe and a flat 2D GIS map from the same data,
 * with drill-down Earth → continent → country → county → project → site.
 * Every figure in the side panel is counted from the features it is given; nothing is invented.
 */
export default function EarthExplorer({
  features,
  mode,
  variant = "full",
  signedIn,
  ownProjectIds,
  insights,
  activity,
  basePath,
}: {
  features: FeatureCollection;
  mode: ExplorerMode;
  variant?: Variant;
  signedIn: boolean;
  /** Projects the viewer may open in the workspace. */
  ownProjectIds?: string[];
  insights?: Record<string, Insight>;
  activity?: ActivityEntry[];
  /** Page this explorer lives on; its `?at=` parameter holds the location. */
  basePath: string;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  const [kenya, setKenya] = useState<FeatureCollection | null>(null);
  // First-level regions of the selected country (any country other than Kenya), fetched on demand.
  const [regions, setRegions] = useState<{ iso2: string; data: FeatureCollection | null } | null>(null);
  const counties = useMemo<FeatureCollection | null>(() => {
    const extra = regions?.data?.features ?? [];
    if (!kenya && extra.length === 0) return null;
    return { type: "FeatureCollection", features: [...(kenya?.features ?? []), ...extra] };
  }, [kenya, regions]);
  const hero = variant === "hero";

  // Second-level units (districts, sub-counties) inside the selected region, fetched on demand for any country.
  const [districts, setDistricts] = useState<{ key: string; data: FeatureCollection | null } | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [path, setPath] = useState<GeoPath>(() => {
    if (hero) return EARTH;
    const params = new URLSearchParams(window.location.search);
    return decodePath(params.get("at") ?? readStored());
  });
  const [flat, setFlat] = useState(() => !hero && new URLSearchParams(window.location.search).get("view") === "2d");
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [overlays, setOverlays] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OVERLAYS.map((o) => [o.id, !!o.available && !!o.defaultOn])),
  );
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<{ title: string; lines: string[]; href?: string } | null>(null);

  const places = useMemo(() => placeProjects(features, countries, counties), [features, countries, counties]);
  const sites = useMemo(() => featuresOfKind(features, "site"), [features]);
  const observations = useMemo(() => featuresOfKind(features, "observation"), [features]);
  const boundaries = useMemo(() => featuresOfKind(features, "boundary"), [features]);
  const hasKenya = places.some((p) => placeKey(p.props.country) === "kenya");
  const wantCounties = path.country === "KE" || hasKenya;

  // Reference boundaries are static files shipped with the app.
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/countries.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && data && setCountries(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!wantCounties || kenya) return;
    let cancelled = false;
    fetch("/geo/kenya-counties.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && data && setKenya(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wantCounties, kenya]);
  const regionCountry = path.country && path.country !== "KE" ? path.country : null;
  useEffect(() => {
    if (!regionCountry || regions?.iso2 === regionCountry) return;
    let cancelled = false;
    fetch(`/geo/regions/${regionCountry}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && setRegions({ iso2: regionCountry, data: data && Array.isArray(data.features) ? data : null }))
      .catch(() => !cancelled && setRegions({ iso2: regionCountry, data: null }));
    return () => {
      cancelled = true;
    };
  }, [regionCountry, regions]);
  const selectedRegion = useMemo(
    () => (path.country && path.county ? counties?.features.find((f) => f.properties?.country === path.country && placeKey(f.properties?.name) === placeKey(path.county)) : undefined),
    [counties, path.country, path.county],
  );
  const districtKey = selectedRegion && path.country ? `${path.country}/${placeKey(path.county)}` : null;
  useEffect(() => {
    if (hero || !districtKey || !selectedRegion || districts?.key === districtKey) return;
    const box = boundsOf(selectedRegion.geometry);
    if (!box) return;
    let cancelled = false;
    fetch(`/geo/regions/${path.country}?level=2&bbox=${box.map((n) => n.toFixed(3)).join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FeatureCollection | null) => {
        if (cancelled) return;
        // The server answers by bounding box; only the units centred inside the region's own outline are kept.
        const inside = (data?.features ?? []).filter((f) => Array.isArray(f.properties?.centre) && pointInGeometry(f.properties!.centre, selectedRegion.geometry));
        setDistricts({ key: districtKey, data: inside.length ? { type: "FeatureCollection", features: inside } : null });
      })
      .catch(() => !cancelled && setDistricts({ key: districtKey, data: null }));
    return () => {
      cancelled = true;
    };
  }, [hero, districtKey, selectedRegion, districts, path.country]);
  const shownDistricts = districtKey && districts?.key === districtKey ? districts.data : null;
  const districtFeature = district ? shownDistricts?.features.find((f) => f.properties?.name === district) : undefined;

  // True while the outlines of the selected country are still on their way.
  const regionsPending = path.country === "KE" ? !kenya : !!regionCountry && regions?.iso2 !== regionCountry;

  // ---- Navigation -------------------------------------------------------------------------
  const go = useCallback(
    (next: GeoPath) => {
      if (hero) {
        router.push(`/explore?at=${encodePath(next)}`);
        return;
      }
      setNote(null);
      setDistrict(null);
      setPath(next);
      setPanelOpen(true);
    },
    [hero, router],
  );

  const goProject = useCallback(
    (projectId: string, site: string | null = null) => {
      const place = places.find((p) => p.id === projectId);
      if (!place) return;
      go({ continent: place.continent, country: place.iso2, county: place.county, project: place.id, site });
    },
    [places, go],
  );

  // Keep the location in the URL and in the session, so it survives a visit to a project workspace.
  useEffect(() => {
    if (hero) return;
    const encoded = encodePath(path);
    const params = new URLSearchParams(window.location.search);
    if (encoded) params.set("at", encoded);
    else params.delete("at");
    if (flat) params.set("view", "2d");
    else params.delete("view");
    const search = params.toString();
    window.history.replaceState(null, "", `${basePath}${search ? `?${search}` : ""}`);
    try {
      window.sessionStorage.setItem(STORE_KEY, encoded);
    } catch {}
  }, [path, flat, hero, basePath]);

  // ---- Map construction -------------------------------------------------------------------
  const handlers = useRef({ go, goProject, places, setNote, countries, setDistrict });
  useEffect(() => {
    handlers.current = { go, goProject, places, setNote, countries, setDistrict };
  }, [go, goProject, places, countries]);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !container.current) return;
      registerImagery(maplibregl);
      try {
        map = new maplibregl.Map({
          container: container.current,
          style: baseStyle("satellite"),
          center: [22, 4],
          zoom: 1.4,
          minZoom: 0.6,
          // Imagery stops at its native zoom and is enlarged beyond it; zoom 20 brings the scale bar to 5 m.
          maxZoom: 20,
          attributionControl: { compact: true },
          // An embedded map must not swallow page scrolling.
          cooperativeGestures: variant === "embedded",
          scrollZoom: !hero,
        });
      } catch {
        setFailed(true); // WebGL is unavailable on this device
        return;
      }
      mapRef.current = map;
      reportEarthProgress("start");
      map.once("idle", () => reportEarthProgress("ready"));
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: !hero }), "bottom-right");
      if (!hero) map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

      // Layers are added as soon as the style is parsed, so project markers never wait for imagery to download.
      map.once("style.load", () => {
        if (!map || cancelled) return;
        const geojson = (id: string, extra: object = {}) => map!.addSource(id, { type: "geojson", data: EMPTY, ...extra });
        geojson("countries");
        geojson("counties", { attribution: "Regions: geoBoundaries" });
        geojson("districts");
        geojson("boundaries");
        geojson("projects", { cluster: true, clusterRadius: 42, clusterMaxZoom: 8 });
        geojson("sites");
        geojson("observations");
        map.addSource("landcover", {
          type: "raster",
          tileSize: 256,
          minzoom: 9,
          tiles: [
            `${LAND_COVER_SERVICE}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&time=${yearRange(LAND_COVER_YEAR)}&f=image`,
          ],
          attribution: "Land cover © Impact Observatory, Microsoft, Esri",
        });

        // World Database on Protected Areas, drawn by its own map service one tile at a time.
        map.addSource("protected", {
          type: "raster",
          tileSize: 256,
          minzoom: 3,
          tiles: [`${PROTECTED_AREAS_SERVICE}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`],
          attribution: "Protected areas © UNEP-WCMC and IUCN (WDPA)",
        });

        const font = ["Noto Sans Regular"];
        const bold = ["Noto Sans Bold"];
        const halo = { "text-halo-color": "rgba(12,26,20,0.85)", "text-halo-width": 1.4, "text-color": "#f6f2e8" };

        map.addLayer({ id: "landcover", type: "raster", source: "landcover", minzoom: 9, paint: { "raster-opacity": 0.7 }, layout: { visibility: "none" } });
        map.addLayer({ id: "protected", type: "raster", source: "protected", minzoom: 3, paint: { "raster-opacity": 0.75 }, layout: { visibility: "none" } });
        map.addLayer({ id: "countries-fill", type: "fill", source: "countries", paint: { "fill-color": "#a7bfa9", "fill-opacity": 0 } });
        map.addLayer({ id: "countries-line", type: "line", source: "countries", paint: { "line-color": "#f6f2e8", "line-opacity": 0.4, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.2] } });
        map.addLayer({ id: "counties-fill", type: "fill", source: "counties", minzoom: 4, paint: { "fill-color": "#a7bfa9", "fill-opacity": 0 } });
        map.addLayer({ id: "counties-line", type: "line", source: "counties", minzoom: 4, paint: { "line-color": "#dfe8df", "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 9, 1.4] } });
        map.addLayer({
          id: "counties-label",
          type: "symbol",
          source: "counties",
          minzoom: 6,
          maxzoom: 11,
          layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-letter-spacing": 0.04 },
          paint: halo,
        });
        map.addLayer({ id: "districts-fill", type: "fill", source: "districts", minzoom: 6, paint: { "fill-color": "#f4783e", "fill-opacity": 0 } });
        map.addLayer({ id: "districts-line", type: "line", source: "districts", minzoom: 6, paint: { "line-color": "#f6f2e8", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 12, 1.1], "line-dasharray": [3, 2] } });
        map.addLayer({
          id: "districts-label",
          type: "symbol",
          source: "districts",
          minzoom: 8,
          layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-letter-spacing": 0.12, "text-transform": "uppercase", "text-max-width": 9 },
          paint: halo,
        });
        // Names of towns, villages and smaller settlements, from OpenStreetMap: the smaller the place, the
        // closer the zoom at which it appears, so remote settlements show once the map is close enough.
        map.addSource("places", { type: "vector", url: PLACE_NAMES_TILES });
        const placeName = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]] as unknown as string;
        const placeLayer = (id: string, classes: string[], minzoom: number, size: number) =>
          map!.addLayer({
            id,
            type: "symbol",
            source: "places",
            "source-layer": "place",
            minzoom,
            filter: ["in", ["get", "class"], ["literal", classes]],
            layout: { "text-field": placeName, "text-font": font, "text-size": size, "symbol-sort-key": ["coalesce", ["get", "rank"], 99], "text-max-width": 8 },
            paint: halo,
          });
        placeLayer("places-local", ["hamlet", "isolated_dwelling", "neighbourhood", "quarter", "locality"], 12, 10);
        placeLayer("places-village", ["village", "suburb"], 9, 11);
        placeLayer("places-town", ["city", "town"], 5, 12.5);
        // Administrative names are placed before settlement names, so they are not crowded out.
        map.moveLayer("districts-label");
        map.moveLayer("counties-label");
        map.addLayer({ id: "boundaries-fill", type: "fill", source: "boundaries", paint: { "fill-color": "#5fb37f", "fill-opacity": 0.22 } });
        map.addLayer({ id: "boundaries-line", type: "line", source: "boundaries", paint: { "line-color": "#d9f0dd", "line-width": 2 } });
        map.addLayer({ id: "obs-pt", type: "circle", source: "observations", minzoom: 8, paint: { "circle-radius": 4.5, "circle-color": "#c0672f", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 } });
        map.addLayer({ id: "sites-pt", type: "circle", source: "sites", minzoom: 7, paint: { "circle-radius": 6, "circle-color": "#1f5f78", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
        map.addLayer({
          id: "sites-label",
          type: "symbol",
          source: "sites",
          minzoom: 11,
          layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" },
          paint: halo,
        });
        map.addLayer({
          id: "projects-cluster",
          type: "circle",
          source: "projects",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#216b45",
            "circle-stroke-color": "rgba(246,242,232,0.9)",
            "circle-stroke-width": 2,
            "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
          },
        });
        map.addLayer({
          id: "projects-count",
          type: "symbol",
          source: "projects",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": bold, "text-size": 12, "text-allow-overlap": true },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "projects-selected",
          type: "circle",
          source: "projects",
          filter: ["==", ["get", "project_id"], ""],
          paint: { "circle-radius": 15, "circle-color": "rgba(246,242,232,0.25)", "circle-stroke-color": "#f6f2e8", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "projects-pt",
          type: "circle",
          source: "projects",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-radius": 7.5, "circle-color": STATUS_COLOR, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "projects-label",
          type: "symbol",
          source: "projects",
          minzoom: 6,
          filter: ["!", ["has", "point_count"]],
          layout: { "text-field": ["get", "name"], "text-font": bold, "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 10, "text-optional": true },
          paint: halo,
        });

        const interactive = ["sites-pt", "obs-pt", "projects-pt", "projects-cluster", "boundaries-fill", "districts-fill", "counties-fill", "countries-fill"];
        map.on("click", async (event: MapMouseEvent) => {
          const hit = map!.queryRenderedFeatures(event.point, { layers: interactive.filter((id) => map!.getLayer(id)) })[0];
          if (!hit) return;
          const props = (hit.properties ?? {}) as Props;
          const h = handlers.current;
          switch (hit.layer.id) {
            case "sites-pt":
              h.goProject(String(props.project_id), String(props.site_id));
              break;
            case "obs-pt":
              h.goProject(String(props.project_id), props.site_id ? String(props.site_id) : null);
              h.setNote({
                title: String(props.observation_type ?? "Observation").replace(/_/g, " "),
                lines: [`Observed ${props.observation_date}`, `${props.value_basis === "estimated" ? "Estimated" : "Measured"} · ${String(props.review_status).replace(/_/g, " ")}`],
                href: `/dashboard/monitoring/${props.record_id}`,
              });
              break;
            case "projects-pt":
            case "boundaries-fill":
              h.goProject(String(props.project_id));
              break;
            case "projects-cluster": {
              const source = map!.getSource("projects") as GeoJSONSource;
              const zoom = await source.getClusterExpansionZoom(Number(props.cluster_id));
              map!.easeTo({ center: lngLatOf(hit.geometry), zoom: zoom + 0.5 });
              break;
            }
            case "districts-fill":
              h.setDistrict(String(props.name));
              break;
            case "counties-fill":
              h.go({
                continent: h.countries?.features.find((f) => f.properties?.iso2 === props.country)?.properties?.continent ?? null,
                country: String(props.country),
                county: String(props.name),
                project: null,
                site: null,
              });
              break;
            case "countries-fill":
              if (props.iso2 && props.iso2 !== "-99") h.go({ continent: String(props.continent), country: String(props.iso2), county: null, project: null, site: null });
              break;
          }
        });
        map.on("mousemove", (event: MapMouseEvent) => {
          const over = map!.queryRenderedFeatures(event.point, { layers: interactive.filter((id) => map!.getLayer(id)) }).length > 0;
          map!.getCanvas().style.cursor = over ? "pointer" : "";
        });
        reportEarthProgress("style");
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [variant, hero]);

  // ---- Data → map sources -----------------------------------------------------------------
  const setData = useCallback((id: string, data: FeatureCollection | null) => {
    (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data ?? EMPTY);
  }, []);
  const collection = (list: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features: list });

  useEffect(() => {
    if (!ready) return;
    if (countries) reportEarthProgress("data");
    setData("countries", countries);
  }, [ready, countries, setData]);
  useEffect(() => {
    if (!ready) return;
    setData("counties", counties);
  }, [ready, counties, setData]);
  useEffect(() => {
    if (!ready) return;
    setData("districts", shownDistricts);
  }, [ready, shownDistricts, setData]);
  // Highlight the chosen district and bring it into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setPaintProperty("districts-fill", "fill-opacity", ["case", ["==", ["get", "name"], district ?? ""], 0.28, 0]);
    const box = districtFeature && boundsOf(districtFeature.geometry);
    if (box) map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 14, duration: 1200 });
  }, [ready, district, districtFeature]);
  useEffect(() => {
    if (!ready) return;
    setData("projects", collection(featuresOfKind(features, "project")));
    setData("boundaries", collection(boundaries));
    setData("sites", collection(sites));
    setData("observations", collection(observations));
  }, [ready, features, boundaries, sites, observations, setData]);

  // ---- View state → map -------------------------------------------------------------------
  useEffect(() => {
    if (ready) mapRef.current?.setProjection({ type: flat ? "mercator" : "globe" });
  }, [ready, flat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    BASEMAPS.forEach((b) => map.setLayoutProperty(`base-${b.id}`, "visibility", b.id === basemap ? "visible" : "none"));
    const dark = basemap === "satellite";
    map.setPaintProperty("countries-line", "line-color", dark ? "#f6f2e8" : "#3f5a4c");
    map.setPaintProperty("counties-line", "line-color", dark ? "#dfe8df" : "#5d7a69");
    map.setPaintProperty("districts-line", "line-color", dark ? "#f6f2e8" : "#5d7a69");
    map.setPaintProperty("boundaries-line", "line-color", dark ? "#d9f0dd" : "#216b45");
    for (const id of ["counties-label", "districts-label", "places-town", "places-village", "places-local", "sites-label", "projects-label"]) {
      map.setPaintProperty(id, "text-color", dark ? "#f6f2e8" : "#123c2b");
      map.setPaintProperty(id, "text-halo-color", dark ? "rgba(12,26,20,0.85)" : "rgba(255,255,255,0.9)");
    }
  }, [ready, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [overlay, layers] of Object.entries(OVERLAY_LAYERS)) {
      for (const id of layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", overlays[overlay] ? "visible" : "none");
    }
  }, [ready, overlays]);

  // Highlight the selected continent / country / county / project.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const countryOpacity: ExpressionSpecification = path.country
      ? ["case", ["==", ["get", "iso2"], path.country], path.county || path.project ? 0.08 : 0.28, 0]
      : ["case", ["==", ["get", "continent"], path.continent ?? "Africa"], path.continent ? 0.24 : 0.12, 0];
    map.setPaintProperty("countries-fill", "fill-opacity", countryOpacity);
    map.setPaintProperty("counties-fill", "fill-opacity", ["case", ["all", ["==", ["get", "name"], path.county ?? ""], ["==", ["get", "country"], path.country ?? ""]], path.project ? 0.1 : 0.3, 0]);
    map.setFilter("projects-selected", ["==", ["get", "project_id"], path.project ?? ""]);
    map.setPaintProperty("sites-pt", "circle-radius", ["case", ["==", ["get", "site_id"], path.site ?? ""], 10, 6]);
  }, [ready, path]);

  // Move the camera to the selected place.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || hero) return;
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    // Keep the selected place clear of the side panel (wide screens) or the bottom drawer (phones).
    const drawer = Math.round((container.current?.clientHeight ?? 600) * 0.5);
    const padding = wide ? { top: 100, bottom: 50, left: variant === "full" ? 430 : 360, right: 70 } : { top: 130, bottom: drawer, left: 24, right: 24 };
    const fit = (b: Bounds, maxZoom: number) =>
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding, maxZoom, duration: 1600, essential: false },
      );
    const level = levelOf(path);

    if (level === "site") {
      const site = sites.find((f) => f.properties?.site_id === path.site);
      if (site) return void map.flyTo({ center: lngLatOf(site.geometry), zoom: 15, duration: 1400, padding });
    }
    if (level === "site" || level === "project") {
      const boundary = boundaries.find((f) => f.properties?.project_id === path.project);
      const box = boundary && boundsOf(boundary.geometry);
      if (box) return void fit(box, 15);
      const place = places.find((p) => p.id === path.project);
      if (place) return void map.flyTo({ center: place.lngLat, zoom: 11.5, duration: 1600, padding });
    }
    if (level === "county" || level === "project" || level === "site") {
      const county = counties?.features.find((f) => f.properties?.country === path.country && placeKey(f.properties?.name) === placeKey(path.county));
      const box = county && boundsOf(county.geometry);
      if (box) return void fit(box, 11);
      if (path.county && regionsPending) return; // wait for the outlines of this country
    }
    if (path.country) {
      const country = countries?.features.find((f) => f.properties?.iso2 === path.country);
      const box = country && mainlandBounds(country.geometry);
      if (box) return void fit(box, 7);
      if (!countries) return;
    }
    if (path.continent && CONTINENT_BOUNDS[path.continent]) return void fit(CONTINENT_BOUNDS[path.continent], 4);
    map.flyTo({ center: [22, 4], zoom: flat ? 1.2 : 1.6, duration: 1600 });
    // `flat` is left out on purpose: switching 3D / 2D keeps the current camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path, countries, counties, regionsPending, hero, variant]);

  // ---- Breadcrumb and search --------------------------------------------------------------
  const countryName = countries?.features.find((f) => f.properties?.iso2 === path.country)?.properties?.name ?? path.country;
  const project = path.project ? places.find((p) => p.id === path.project) : undefined;
  const siteName = path.site ? sites.find((f) => f.properties?.site_id === path.site)?.properties?.name : null;
  const crumbs: { label: string; to: GeoPath }[] = [{ label: "Earth", to: EARTH }];
  if (path.continent) crumbs.push({ label: path.continent, to: { ...EARTH, continent: path.continent } });
  if (path.country) crumbs.push({ label: String(countryName), to: { ...EARTH, continent: path.continent, country: path.country } });
  if (path.county) crumbs.push({ label: path.country === "KE" ? `${path.county} County` : path.county, to: { ...path, project: null, site: null } });
  if (district && !path.project) crumbs.push({ label: district, to: path });
  if (path.project) crumbs.push({ label: project?.props.name ?? "Project", to: { ...path, site: null } });
  if (path.site) crumbs.push({ label: String(siteName ?? "Site"), to: path });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const found: { key: string; label: string; kind: string; act: () => void }[] = [];
    for (const p of places) {
      if (`${p.props.name} ${p.props.code} ${p.county}`.toLowerCase().includes(q)) found.push({ key: `p${p.id}`, label: `${p.props.name}`, kind: `Project · ${p.county}`, act: () => goProject(p.id) });
    }
    for (const s of sites) {
      if (String(s.properties?.name).toLowerCase().includes(q))
        found.push({ key: `s${s.properties?.site_id}`, label: String(s.properties?.name), kind: `Site · ${s.properties?.code}`, act: () => goProject(String(s.properties?.project_id), String(s.properties?.site_id)) });
    }
    for (const c of counties?.features ?? []) {
      const name = String(c.properties?.name);
      const iso2 = String(c.properties?.country);
      const nation = countries?.features.find((f) => f.properties?.iso2 === iso2)?.properties;
      if (name.toLowerCase().includes(q))
        found.push({
          key: `c${iso2}${name}`,
          label: iso2 === "KE" ? `${name} County` : name,
          kind: `${iso2 === "KE" ? "County" : "Region"} · ${nation?.name ?? iso2}`,
          act: () => go({ continent: nation?.continent ?? null, country: iso2, county: name, project: null, site: null }),
        });
    }
    for (const c of countries?.features ?? []) {
      const p = c.properties ?? {};
      if (p.iso2 && p.iso2 !== "-99" && String(p.name).toLowerCase().includes(q))
        found.push({ key: `n${p.iso2}`, label: String(p.name), kind: `Country · ${p.continent}`, act: () => go({ ...EARTH, continent: p.continent, country: p.iso2 }) });
    }
    return found.slice(0, 8);
  }, [query, places, sites, counties, countries, go, goProject]);

  const scope = useMemo(() => places.filter((p) => inPath(p, path)), [places, path]);

  if (failed) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-3xl bg-night p-6 text-center text-sm text-white">
        This device cannot display the 3D Earth (WebGL is unavailable). Project lists remain available from the menu.
      </div>
    );
  }

  const chip = "glass-strong rounded-full text-white";

  return (
    <div className={`earth relative h-full w-full overflow-hidden ${hero ? "" : "rounded-3xl"}`}>
      {/* The map library sets its own positioning on the element it is given, so it gets a plain filler inside a positioned frame. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="application" aria-label={flat ? "2D GIS map of projects" : "3D Earth with project locations"} />
      </div>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-sage" role="status">
          Loading the Earth…
        </div>
      )}

      {hero ? (
        <p className={`${chip} pointer-events-none absolute bottom-4 left-4 px-3 py-1.5 text-xs`}>
          {places.length > 0 ? `${places.length} project location${places.length === 1 ? "" : "s"} · ` : ""}Drag to rotate · select a country or project
        </p>
      ) : (
        <>
          {/* Breadcrumb, search and view controls */}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start gap-2">
            <nav aria-label="Geographic location" className={`${chip} pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto px-2 py-1.5 text-xs`}>
              {levelOf(path) !== "earth" && (
                <button type="button" onClick={() => go(parentOf(path))} className="mr-1 flex shrink-0 items-center rounded-full bg-white/10 p-1 hover:bg-white/20" aria-label="Go back one level">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}
              {crumbs.map((crumb, i) => (
                <span key={crumb.label + i} className="flex shrink-0 items-center gap-1">
                  {i > 0 && <span aria-hidden="true" className="text-sage/70">/</span>}
                  {i === crumbs.length - 1 ? (
                    <span aria-current="location" className="px-1 font-semibold text-white">{crumb.label}</span>
                  ) : (
                    <button type="button" onClick={() => go(crumb.to)} className="rounded px-1 text-sage hover:text-white">
                      {crumb.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>

            <div className="pointer-events-auto relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sage" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search places and projects"
                aria-label="Search a location or project"
                className={`${chip} w-full py-2 pl-9 pr-3 text-xs placeholder:text-sage/80 focus:outline-none focus:ring-2 focus:ring-sage`}
              />
              {query.trim().length >= 2 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-1 glass-strong overflow-hidden rounded-2xl text-sm shadow-lg">
                  {results.length === 0 && <li className="px-3 py-2.5 text-muted-grey">No matching place or project.</li>}
                  {results.map((result) => (
                    <li key={result.key}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-sand"
                        onClick={() => {
                          result.act();
                          setQuery("");
                        }}
                      >
                        <span className="block font-medium text-heading">{result.label}</span>
                        <span className="block text-xs text-muted-grey">{result.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pointer-events-auto flex gap-2">
              <div className={`${chip} flex p-0.5 text-xs`} role="group" aria-label="Map view">
                <button type="button" aria-pressed={!flat} onClick={() => setFlat(false)} className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 ${!flat ? "bg-white font-semibold text-night" : "text-sage hover:text-white"}`}>
                  <Globe2 className="h-3.5 w-3.5" /> 3D Earth
                </button>
                <button type="button" aria-pressed={flat} onClick={() => setFlat(true)} className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 ${flat ? "bg-white font-semibold text-night" : "text-sage hover:text-white"}`}>
                  <MapIcon className="h-3.5 w-3.5" /> 2D GIS
                </button>
              </div>
              <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)} className={`${chip} flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-night`}>
                <Layers className="h-3.5 w-3.5" /> Layers
              </button>
            </div>
          </div>

          {layersOpen && (
            <section aria-label="Layers and legend" className="absolute right-3 top-28 z-20 max-h-[70%] w-[min(20rem,calc(100%-1.5rem))] glass-strong overflow-y-auto rounded-3xl p-4 text-sm shadow-xl sm:top-16">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-heading">Layers and legend</h2>
                <button type="button" onClick={() => setLayersOpen(false)} aria-label="Close layers" className="rounded-full p-1 hover:bg-sand">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-grey">Basemap</p>
              <div className="mt-1.5 flex gap-1.5">
                {BASEMAPS.map((b) => (
                  <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)} className={`rounded-full border px-3 py-1 text-xs ${basemap === b.id ? "border-white bg-white text-night" : "border-subtle-border bg-surface text-charcoal hover:bg-sand"}`}>
                    {b.label}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-grey">Data layers</p>
              <ul className="mt-1.5 space-y-2">
                {OVERLAYS.map((overlay) => {
                  const empty = overlay.id === "observations" && observations.length === 0;
                  return (
                    <li key={overlay.id}>
                      <label className={`flex items-start gap-2.5 ${overlay.available ? "cursor-pointer" : "opacity-60"}`}>
                        <input
                          type="checkbox"
                          className="mt-1 accent-[#f4783e]"
                          disabled={!overlay.available}
                          checked={!!overlays[overlay.id]}
                          onChange={(event) => setOverlays({ ...overlays, [overlay.id]: event.target.checked })}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-medium text-charcoal">
                            <span
                              aria-hidden="true"
                              className={overlay.shape === "dot" ? "h-2.5 w-2.5 rounded-full" : overlay.shape === "line" ? "h-0.5 w-3.5" : "h-2.5 w-3.5 rounded-sm"}
                              style={{ background: overlay.swatch, outline: "1px solid rgba(0,0,0,0.15)" }}
                            />
                            {overlay.label}
                          </span>
                          <span className="block text-xs text-muted-grey">
                            {overlay.available ? (
                              <>
                                <span className="font-medium text-heading" title={DATA_CLASS[overlay.dataClass].hint}>{DATA_CLASS[overlay.dataClass].label}</span> · {overlay.source}
                                {overlay.id === "landcover" && ` · ${LAND_COVER_YEAR} · zoom in to a project`}
                                {overlay.id === "protected" && " · zoom in to a country"}
                                {empty && (signedIn ? " · none recorded in view" : " · visible to project participants")}
                              </>
                            ) : (
                              overlay.note
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-grey">Project status</p>
              <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-charcoal">
                {[
                  ["active", "Active"],
                  ["approved", "Approved"],
                  ["completed", "Completed"],
                  ["on_hold", "On hold"],
                  ...(mode === "explore" ? [] : [["pending_approval", "Pending / revision"], ["draft", "Draft"], ["rejected", "Rejected"]]),
                ].map(([status, label]) => (
                  <li key={status} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[status] }} /> {label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ExplorerPanel
            mode={mode}
            variant={variant}
            path={path}
            open={panelOpen}
            onToggle={() => setPanelOpen(!panelOpen)}
            scope={scope}
            totalProjects={places.length}
            sites={sites}
            observations={observations}
            boundaries={boundaries}
            insights={insights}
            activity={activity}
            note={note}
            placeLabel={crumbs[crumbs.length - 1].label}
            signedIn={signedIn}
            ownProjectIds={ownProjectIds}
            go={go}
            goProject={goProject}
            returnTo={`${basePath}?at=${encodePath(path)}`}
          />
        </>
      )}
    </div>
  );
}
