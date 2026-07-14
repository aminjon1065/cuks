-- Martin function tile source for the filtered incidents layer (docs/modules/10
-- §4). Lives in the `gis` schema so Martin auto-publishes it alongside the gis
-- tables. Returns MVT for tile (z,x,y), optionally filtered by status / minimum
-- severity / type-code prefix passed as query params. Hand-written (drizzle-kit
-- does not model functions).
CREATE OR REPLACE FUNCTION gis.incidents_mvt(
  z integer, x integer, y integer, query_params json
) RETURNS bytea AS $$
DECLARE
  mvt bytea;
  env geometry := ST_TileEnvelope(z, x, y); -- 3857 tile envelope
BEGIN
  SELECT ST_AsMVT(tile, 'incidents', 4096, 'geom') INTO mvt
  FROM (
    SELECT
      ST_AsMVTGeom(ST_Transform(i.geom, 3857), env, 4096, 64, true) AS geom,
      i.id, i.number, i.type_code, i.severity, i.status,
      extract(epoch from i.occurred_at)::bigint AS occurred_at
    FROM app.incidents i
    WHERE i.deleted_at IS NULL
      AND i.geom && ST_Transform(env, 4326)
      AND (query_params->>'status' IS NULL OR i.status = query_params->>'status')
      AND (query_params->>'severity' IS NULL OR i.severity >= (query_params->>'severity')::int)
      AND (query_params->>'type' IS NULL OR i.type_code LIKE (query_params->>'type') || '%')
  ) AS tile
  WHERE tile.geom IS NOT NULL;
  RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
