declare module "shpjs" {
  /** Parses a zipped shapefile into one GeoJSON FeatureCollection, or several when the zip holds several shapefiles. */
  const shp: (input: ArrayBuffer) => Promise<unknown>;
  export default shp;
}
