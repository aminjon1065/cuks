-- Tiles for imported layers (task 2.8). Each import lands in its own physical
-- table `gis.l_<slug>` (docs/modules/10 §3) so QGIS/ArcGIS see typed columns — but
-- Martin builds its table catalog once at startup, so a table created after boot
-- would not be servable until the tile server restarts. One function source solves
-- it: the layer id comes in as a query param, the physical table is looked up in
-- the registry (never taken from the client), and the tile is built from it.
--
-- The table name is resolved from gis.layers, and injected with %I (quote_ident),
-- so a crafted `?layer=` can only ever miss and return an empty tile.
CREATE OR REPLACE FUNCTION gis.imported_mvt(
  z integer, x integer, y integer, query_params json
) RETURNS bytea AS $$
DECLARE
  mvt bytea;
  env geometry := ST_TileEnvelope(z, x, y); -- 3857 tile envelope
  raw_layer text := query_params->>'layer';
  layer_id uuid := CASE
    WHEN pg_input_is_valid(raw_layer, 'uuid') THEN raw_layer::uuid
    ELSE NULL
  END;
  target text;
BEGIN
  IF layer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.table_name INTO target
  FROM gis.layers l
  WHERE l.id = layer_id
    AND l.kind = 'imported'
    AND l.deleted_at IS NULL
    AND l.table_name IS NOT NULL;

  IF target IS NULL THEN
    RETURN NULL; -- unknown, deleted, or not an imported layer → empty tile
  END IF;

  EXECUTE format(
    $q$
      SELECT ST_AsMVT(tile, 'imported', 4096, 'geom')
      FROM (
        SELECT
          ST_AsMVTGeom(ST_Transform(t.geom, 3857), $1, 4096, 64, true) AS geom,
          t.id::text AS id,
          -- The source's own columns, so the map inspector can show them without a
          -- round-trip. MVT properties are scalars, so they travel as one JSON text
          -- value (the same shape a drawn feature's `props` has).
          (to_jsonb(t) - 'geom' - 'id')::text AS props
        FROM gis.%I t
        WHERE t.geom && ST_Transform($1, 4326)
      ) AS tile
      WHERE tile.geom IS NOT NULL
    $q$,
    target
  )
  INTO mvt
  USING env;

  RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
