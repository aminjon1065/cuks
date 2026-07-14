-- Harden gis.incidents_mvt filter parsing (review 2.2). Martin passes raw query
-- text into query_params, so a crafted/empty `?severity=` reached an unguarded
-- ::int cast and aborted the whole tile query (Martin 500). Parse the filters
-- once into locals and guard the int cast with pg_input_is_valid (PG16+), so bad
-- input is simply ignored (no filter) instead of erroring.
CREATE OR REPLACE FUNCTION gis.incidents_mvt(
  z integer, x integer, y integer, query_params json
) RETURNS bytea AS $$
DECLARE
  mvt bytea;
  env geometry := ST_TileEnvelope(z, x, y); -- 3857 tile envelope
  f_status text := query_params->>'status';
  f_type text := query_params->>'type';
  f_sev int := CASE
    WHEN pg_input_is_valid(query_params->>'severity', 'integer')
    THEN (query_params->>'severity')::int
    ELSE NULL
  END;
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
      AND (f_status IS NULL OR i.status = f_status)
      AND (f_sev IS NULL OR i.severity >= f_sev)
      AND (f_type IS NULL OR i.type_code LIKE f_type || '%')
  ) AS tile
  WHERE tile.geom IS NOT NULL;
  RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
