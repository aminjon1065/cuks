-- Harden incident tiles after production-style adversarial checks:
--   * bigint-valid epochs outside PostgreSQL's timestamptz range fail closed;
--   * point/cluster ownership is half-open, so a seam feature is emitted by
--     exactly one tile (with explicit outer-world edge ownership).
CREATE OR REPLACE FUNCTION gis.incidents_mvt(
  z integer, x integer, y integer, query_params json
) RETURNS bytea AS $$
DECLARE
  mvt bytea;
  env geometry := ST_TileEnvelope(z, x, y); -- EPSG:3857
  tile_width double precision := ST_XMax(env) - ST_XMin(env);
  grid_size double precision := tile_width * 0.09375; -- 48px of a 512px tile
  query_env geometry := ST_Expand(env, grid_size);

  raw_status text := nullif(query_params->>'status', '');
  raw_type text := nullif(query_params->>'type', '');
  raw_severity text := nullif(query_params->>'severity', '');
  raw_region text := nullif(query_params->>'region', '');
  raw_from text := nullif(query_params->>'from', '');
  raw_to text := nullif(query_params->>'to', '');

  f_severity integer := CASE
    WHEN raw_severity IS NOT NULL AND pg_input_is_valid(raw_severity, 'integer')
    THEN raw_severity::integer
    ELSE NULL
  END;
  f_region uuid := CASE
    WHEN raw_region IS NOT NULL AND pg_input_is_valid(raw_region, 'uuid')
    THEN raw_region::uuid
    ELSE NULL
  END;
  f_from bigint := CASE
    WHEN raw_from IS NOT NULL AND pg_input_is_valid(raw_from, 'bigint')
    THEN raw_from::bigint
    ELSE NULL
  END;
  f_to bigint := CASE
    WHEN raw_to IS NOT NULL AND pg_input_is_valid(raw_to, 'bigint')
    THEN raw_to::bigint
    ELSE NULL
  END;
  valid_filters boolean :=
    (raw_status IS NULL OR raw_status IN ('reported', 'active', 'localized', 'eliminated', 'closed'))
    AND (raw_type IS NULL OR raw_type ~ '^[a-z0-9._-]+$')
    AND (raw_severity IS NULL OR (f_severity BETWEEN 1 AND 5))
    AND (raw_region IS NULL OR f_region IS NOT NULL)
    AND (raw_from IS NULL OR f_from BETWEEN -210866803200 AND 9224318015999)
    AND (raw_to IS NULL OR f_to BETWEEN -210866803200 AND 9224318015999)
    AND (f_from IS NULL OR f_to IS NULL OR f_from < f_to);
BEGIN
  IF NOT valid_filters THEN
    RETURN ''::bytea;
  END IF;

  WITH filtered AS (
    SELECT
      i.id::text AS feature_id,
      i.number,
      i.type_code,
      i.severity,
      i.status,
      extract(epoch from i.occurred_at)::bigint AS occurred_at,
      i.region_id::text AS region_id,
      ST_PointOnSurface(ST_Transform(i.geom, 3857)) AS marker_geom
    FROM app.incidents i
    WHERE i.deleted_at IS NULL
      AND i.geom && ST_Transform(query_env, 4326)
      AND (raw_status IS NULL OR i.status = raw_status)
      AND (f_severity IS NULL OR i.severity >= f_severity)
      AND (raw_type IS NULL OR i.type_code = raw_type)
      AND (f_region IS NULL OR i.region_id = f_region)
      AND (f_from IS NULL OR i.occurred_at >= to_timestamp(f_from))
      AND (f_to IS NULL OR i.occurred_at < to_timestamp(f_to))
  ), bucketed AS (
    SELECT
      f.*,
      ST_SnapToGrid(f.marker_geom, grid_size) AS bucket,
      count(*) OVER (PARTITION BY ST_SnapToGrid(f.marker_geom, grid_size))::integer AS bucket_count
    FROM filtered f
  ), low_zoom AS (
    SELECT
      CASE WHEN b.bucket_count > 1 THEN NULL ELSE min(b.feature_id) END AS feature_id,
      CASE WHEN b.bucket_count > 1 THEN NULL ELSE min(b.number) END AS number,
      CASE WHEN b.bucket_count > 1 THEN NULL ELSE min(b.type_code) END AS type_code,
      max(b.severity)::integer AS severity,
      CASE WHEN b.bucket_count > 1 THEN NULL ELSE min(b.status) END AS status,
      max(b.occurred_at)::bigint AS occurred_at,
      CASE WHEN b.bucket_count > 1 THEN NULL ELSE min(b.region_id) END AS region_id,
      (b.bucket_count > 1) AS is_cluster,
      max(b.bucket_count)::integer AS cluster_count,
      CASE
        WHEN b.bucket_count > 1 THEN ST_Centroid(ST_Collect(b.marker_geom))
        ELSE ST_PointOnSurface(ST_Collect(b.marker_geom))
      END AS feature_geom
    FROM bucketed b
    GROUP BY b.bucket, b.bucket_count
  ), high_zoom AS (
    SELECT
      f.feature_id,
      f.number,
      f.type_code,
      f.severity,
      f.status,
      f.occurred_at,
      f.region_id,
      false AS is_cluster,
      1::integer AS cluster_count,
      f.marker_geom AS feature_geom
    FROM filtered f
  ), features AS (
    SELECT * FROM low_zoom WHERE z < 11
    UNION ALL
    SELECT * FROM high_zoom WHERE z >= 11
  ), tile AS (
    SELECT
      ST_AsMVTGeom(f.feature_geom, env, 4096, 64, true) AS geom,
      f.feature_id,
      f.number,
      f.type_code,
      f.severity,
      f.status,
      f.occurred_at,
      f.region_id,
      f.is_cluster,
      f.cluster_count
    FROM features f
    WHERE ST_X(f.feature_geom) >= ST_XMin(env)
      AND (
        ST_X(f.feature_geom) < ST_XMax(env)
        OR (x = (1::bigint << z) - 1 AND ST_X(f.feature_geom) <= ST_XMax(env))
      )
      AND ST_Y(f.feature_geom) >= ST_YMin(env)
      AND (
        ST_Y(f.feature_geom) < ST_YMax(env)
        OR (y = 0 AND ST_Y(f.feature_geom) <= ST_YMax(env))
      )
  )
  SELECT ST_AsMVT(tile, 'incidents', 4096, 'geom') INTO mvt
  FROM tile
  WHERE tile.geom IS NOT NULL;

  RETURN coalesce(mvt, ''::bytea);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
