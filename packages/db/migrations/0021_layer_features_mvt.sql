-- Drawn features as a function source (task 2.7). The table source `layer_features`
-- cannot be used by the editor: Martin caches table tiles by (source, z, x, y)
-- only, so a freshly drawn or edited feature keeps returning the stale tile. A
-- function source's cache key includes its query params (the same mechanism the
-- incident filters rely on), so the map busts the cache by bumping `?v=` after
-- every write and always sees what it just saved.
--
-- `props` travels as text: MVT properties are scalars, so a jsonb column would be
-- serialized anyway — doing it explicitly keeps the client parsing one shape.
CREATE OR REPLACE FUNCTION gis.layer_features_mvt(
  z integer, x integer, y integer, query_params json
) RETURNS bytea AS $$
DECLARE
  mvt bytea;
  env geometry := ST_TileEnvelope(z, x, y); -- 3857 tile envelope
BEGIN
  SELECT ST_AsMVT(tile, 'layer_features', 4096, 'geom') INTO mvt
  FROM (
    SELECT
      ST_AsMVTGeom(ST_Transform(f.geom, 3857), env, 4096, 64, true) AS geom,
      f.id::text AS id,
      f.layer_id::text AS layer_id,
      f.props::text AS props
    FROM gis.layer_features f
    JOIN gis.layers l ON l.id = f.layer_id
    WHERE l.deleted_at IS NULL              -- a deleted layer disappears from the map
      AND f.geom && ST_Transform(env, 4326)
  ) AS tile
  WHERE tile.geom IS NOT NULL;
  RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
