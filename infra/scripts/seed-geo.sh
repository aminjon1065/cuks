#!/usr/bin/env bash
#
# seed-geo.sh — import Tajikistan administrative boundaries into gis.admin_units
# (docs/modules/10 §3, phase 2.1). Loads region → district → jamoat (ADM1/2/3)
# from geoBoundaries (gbOpen) via ogr2ogr, reprojecting to EPSG:4326 and coercing
# to MultiPolygon, then resolves the parent hierarchy spatially.
#
# This is the FULL production/setup import. For local dev the TS seed
# (packages/db/src/seed.ts → seedGeo) already loads the 5 regions from a committed
# simplified GeoJSON, so the app works without running this script.
#
# Requirements: GDAL/ogr2ogr (present in the worker image, docs/02) and psql.
# Population is not part of geoBoundaries — it is kept from the region seed / a
# separate official source and is left untouched for existing rows.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./infra/scripts/seed-geo.sh
#
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (postgres://…)}"

RELEASE="9469f09" # pinned geoBoundaries release (reproducible)
BASE="https://github.com/wmgeolab/geoBoundaries/raw/${RELEASE}/releaseData/gbOpen/TJK"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "seed-geo: downloading Tajikistan ADM1/ADM2/ADM3 (geoBoundaries ${RELEASE})…"
for lvl in ADM1 ADM2 ADM3; do
  curl -sL --fail "${BASE}/${lvl}/geoBoundaries-TJK-${lvl}.geojson" -o "${WORK}/${lvl}.geojson"
done

# Load each level into its own staging table (WGS84, MultiPolygon).
for lvl in ADM1 ADM2 ADM3; do
  echo "seed-geo: ogr2ogr → gis._imp_${lvl}…"
  ogr2ogr -f PostgreSQL "PG:${DATABASE_URL}" "${WORK}/${lvl}.geojson" \
    -nln "gis._imp_${lvl}" -overwrite \
    -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 -lco GEOMETRY_NAME=geom -lco FID=fid
done

echo "seed-geo: upserting gis.admin_units + resolving parents…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;

-- Level mapping: ADM1=region (stable ISO code), ADM2=district, ADM3=jamoat
-- (globally-unique geoBoundaries shapeID as code).
--
-- Names: geoBoundaries only carries Latin/English names. Regions get curated
-- Russian names by ISO code (matching the dev seed). Districts/jamoats fall back
-- to the source (Latin) name as a PLACEHOLDER pending Russian localization
-- (admin edits, or a supplied names table). On re-import we refresh geometry only
-- and PRESERVE existing names, so a run never clobbers curated/edited names.
insert into gis.admin_units (id, level, code, name_ru, name_tg, geom)
select gen_random_uuid(), 'region', "shapeISO",
  case "shapeISO"
    when 'TJ-SU' then 'Согдийская область'
    when 'TJ-KT' then 'Хатлонская область'
    when 'TJ-GB' then 'Горно-Бадахшанская автономная область'
    when 'TJ-RA' then 'Районы республиканского подчинения'
    when 'TJ-DU' then 'город Душанбе'
    else "shapeName"
  end,
  case "shapeISO"
    when 'TJ-SU' then 'Согдийская область'
    when 'TJ-KT' then 'Хатлонская область'
    when 'TJ-GB' then 'Горно-Бадахшанская автономная область'
    when 'TJ-RA' then 'Районы республиканского подчинения'
    when 'TJ-DU' then 'город Душанбе'
    else "shapeName"
  end,
  st_multi(geom)
from gis._imp_ADM1 where "shapeISO" is not null
on conflict (code) do update set geom = excluded.geom, updated_at = now();

insert into gis.admin_units (id, level, code, name_ru, name_tg, geom)
select gen_random_uuid(), 'district', "shapeID", "shapeName", "shapeName", st_multi(geom)
from gis._imp_ADM2
on conflict (code) do update set geom = excluded.geom, updated_at = now();

insert into gis.admin_units (id, level, code, name_ru, name_tg, geom)
select gen_random_uuid(), 'jamoat', "shapeID", "shapeName", "shapeName", st_multi(geom)
from gis._imp_ADM3
on conflict (code) do update set geom = excluded.geom, updated_at = now();

-- Parent = the higher-level unit whose polygon contains this unit's centroid.
update gis.admin_units d
set parent_id = r.id
from gis.admin_units r
where d.level = 'district' and r.level = 'region'
  and st_contains(r.geom, st_pointonsurface(d.geom));

update gis.admin_units j
set parent_id = d.id
from gis.admin_units d
where j.level = 'jamoat' and d.level = 'district'
  and st_contains(d.geom, st_pointonsurface(j.geom));

drop table if exists gis."_imp_ADM1", gis."_imp_ADM2", gis."_imp_ADM3";
commit;
SQL

echo "seed-geo: done."
psql "$DATABASE_URL" -tAc "select level, count(*) from gis.admin_units group by level order by 1;"
