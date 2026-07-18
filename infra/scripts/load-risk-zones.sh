#!/usr/bin/env bash
#
# load-risk-zones.sh — import the "КАРТА СТИХИЙНЫХ БЕДСТВИЙ РТ" hazard geodata into
# gis.risk_zones (docs/plan/DATA-INTEGRATION.md §D4). Loads three sources via
# ogr2ogr (reprojecting UTM-42N → EPSG:4326, forcing 2D, promoting to MultiPolygon),
# then classifies each into a hazard_code + level with population-at-risk in attrs:
#   1. Бальность_region.shp          — seismic zonation (MSK 7/8/9 балла)
#   2. Зона_стихийных_бедстви (.gdb)  — 1162 disaster zones (households/population)
#   3. З_С_Б_1Степень (.gdb)          — 489 first-degree (highest) disaster zones
#
# The source folder lives OUTSIDE the repo (raw КЧС map data). Point SRC at it.
# Requirements: GDAL/ogr2ogr + psql. DATABASE_URL must be libpq KEYWORD form
# ("host=… user=… dbname=…") so ogr2ogr's PG driver accepts it. Idempotent: the
# import band (source ~ 'КАРТА ЧС 2024') is deleted and rebuilt on every run.
#
# Usage (in a GDAL+psql container, with the map folder mounted at $SRC):
#   SRC="/data/КАРТА СТИХИЙНЫХ БЕДСТВИЯ РТ 01,07,2024" \
#   DATABASE_URL="host=postgres user=cuks password=cuks dbname=cuks" \
#   ./infra/scripts/load-risk-zones.sh
#
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required (libpq keyword form for ogr2ogr)}"
: "${SRC:?SRC required — path to the 'КАРТА СТИХИЙНЫХ БЕДСТВИЯ РТ' folder}"
GDB="${SRC}/Зона повышеной опасности .gdb"
OGR_COMMON=(-overwrite -dim 2 -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326
            -lco GEOMETRY_NAME=geom -lco FID=fid -skipfailures)

echo "load-risk-zones: ogr2ogr → staging (4326, 2D)…"
ogr2ogr -f PostgreSQL "PG:${DATABASE_URL}" "${SRC}/Бальность_region.shp" \
  -nln gis._imp_seismic "${OGR_COMMON[@]}"
ogr2ogr -f PostgreSQL "PG:${DATABASE_URL}" "${GDB}" "Зона_стихийных_бедстви" \
  -nln gis._imp_zsb "${OGR_COMMON[@]}"
ogr2ogr -f PostgreSQL "PG:${DATABASE_URL}" "${GDB}" "З_С_Б_1Степень" \
  -nln gis._imp_zsb1 "${OGR_COMMON[@]}"

echo "load-risk-zones: classify + upsert into gis.risk_zones…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
delete from gis.risk_zones where source like '%КАРТА ЧС 2024%';

-- Map a free-text hazard (possibly compound "сель,оползень") to the primary code.
create or replace function pg_temp.hazard_code(t text) returns text language sql immutable as $$
  select case
    when lower(t) like 'сель%' then 'nat.geo.mudflow'
    when lower(t) like 'оползень%' then 'nat.geo.landslide'
    when lower(t) like 'наводнение%' then 'nat.hydro.flood'
    when lower(t) like 'лавина%' then 'nat.geo.avalanche'
    when lower(t) like 'камнепад%' then 'nat.geo.rockfall'
    when lower(t) like 'подтопление%' then 'nat.hydro.waterlogging'
    when lower(t) like 'подмыв%' then 'nat.geo.landslide'
    when lower(t) like 'ярч%' then 'nat.geo.mudflow'
    when lower(t) like 'эр%' then 'nat.geo.landslide'
    else 'nat.geo.mudflow' end;
$$;

-- 2D valid MultiPolygon (drops non-polygon debris from ST_MakeValid).
create or replace function pg_temp.mp(g geometry) returns geometry language sql immutable as $$
  select st_multi(st_collectionextract(st_makevalid(st_force2d(g)), 3));
$$;

-- 1) Seismic zonation.
insert into gis.risk_zones (id, hazard_code, name, level, geom, attrs, source)
select gen_random_uuid(), 'nat.geophys.earthquake',
  'Сейсмическая зона '||number||' баллов (MSK)',
  case number when '7' then 3 when '8' then 4 when '9' then 5 else 3 end,
  pg_temp.mp(geom), jsonb_build_object('msk_intensity', number::int),
  'Сейсмическое районирование РТ (КАРТА ЧС 2024)'
from gis._imp_seismic where geom is not null and not st_isempty(geom);

-- 2) General disaster zones (population at risk in attrs).
insert into gis.risk_zones (id, hazard_code, name, level, geom, attrs, source)
select gen_random_uuid(), pg_temp.hazard_code(khatar),
  coalesce(nullif(deha,''), nullif(jamoat,''), nullif(nohiya,''), 'Опасная зона'), 3,
  pg_temp.mp(geom),
  jsonb_build_object('households',khojagi,'population',aholi,'jamoat',jamoat,'deha',deha,
    'district',nohiya,'region',viloyat,'hazard_raw',khatar,'degree','general'),
  'Зоны стихийных бедствий (КАРТА ЧС 2024)'
from gis._imp_zsb where geom is not null and not st_isempty(geom);

-- 3) First-degree (highest) disaster zones.
insert into gis.risk_zones (id, hazard_code, name, level, geom, attrs, source)
select gen_random_uuid(), pg_temp.hazard_code("Опасность"),
  coalesce(nullif("Деха",''), nullif("Джамоат",''), nullif("Район",''), 'Опасная зона (1 ст.)'), 4,
  pg_temp.mp(geom),
  jsonb_build_object('households',"Хозяйства",'population',"Население",'jamoat',"Джамоат",'deha',"Деха",
    'district',"Район",'region',"Область",'hazard_raw',"Опасность",'degree','1'),
  'Зоны стихийных бедствий, 1-я степень (КАРТА ЧС 2024)'
from gis._imp_zsb1 where geom is not null and not st_isempty(geom);

drop table if exists gis._imp_seismic, gis._imp_zsb, gis._imp_zsb1;
commit;
SQL

echo "load-risk-zones: done."
psql "$DATABASE_URL" -tAc "select hazard_code, count(*) from gis.risk_zones where source like '%КАРТА ЧС 2024%' group by 1 order by 2 desc;"
