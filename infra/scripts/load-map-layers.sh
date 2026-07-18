#!/usr/bin/env bash
#
# load-map-layers.sh — import reference vector layers from the "КАРТА СТИХИЙНЫХ
# БЕДСТВИЙ РТ" geodatabase into gis.l_<slug> + register them in gis.layers as
# `imported` (docs/plan/DATA-INTEGRATION.md §D5). They then tile through the shared
# `gis.imported_mvt` function source (migration 0023) and appear in the web layer
# panel and in QGIS/ArcGIS — exactly like a layer imported through the app wizard.
#
# Scope note: the offline PMTiles basemap (infra/basemap/region.pmtiles, built by
# build-basemap.sh) already carries roads, rivers, lakes, settlements and labels, so
# those .gdb layers are intentionally NOT imported here (they would duplicate it).
# The unique value is the GLACIER inventory (GLOF-risk context), not in any basemap.
# Add more layers by copying the `import_layer` call below.
#
# Requirements: GDAL/ogr2ogr + psql. DATABASE_URL in libpq KEYWORD form.
#
# Usage (in a GDAL+psql container with the map folder mounted at $SRC):
#   SRC="/data/КАРТА СТИХИЙНЫХ БЕДСТВИЯ РТ 01,07,2024" \
#   DATABASE_URL="host=postgres user=cuks password=cuks dbname=cuks" \
#   ./infra/scripts/load-map-layers.sh
#
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required (libpq keyword form for ogr2ogr)}"
: "${SRC:?SRC required — path to the 'КАРТА СТИХИЙНЫХ БЕДСТВИЯ РТ' folder}"
GDB="${SRC}/Зона повышеной опасности .gdb"

# import_layer <slug> <title> <geometry_type> <color> <sql>
#   loads one .gdb layer into gis.l_<slug> (4326, 2D, promoted to multi), repairs
#   invalid geometries, and registers/refreshes its gis.layers row with an extent.
import_layer() {
  local slug="$1" title="$2" gtype="$3" color="$4" sqlsel="$5"
  local table="l_${slug}"
  echo "load-map-layers: ogr2ogr → gis.${table} (${gtype})…"
  ogr2ogr -f PostgreSQL "PG:${DATABASE_URL}" "${GDB}" \
    -nln "gis.${table}" -overwrite -sql "${sqlsel}" \
    -dim 2 -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 \
    -lco GEOMETRY_NAME=geom -lco FID=id -lco SPATIAL_INDEX=GIST

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
update gis.${table} set geom = st_multi(st_collectionextract(st_makevalid(geom),3))
  where not st_isvalid(geom);
analyze gis.${table};
delete from gis.layers where slug='${slug}';
insert into gis.layers (id,slug,title,kind,geometry_type,table_name,style,min_zoom,description)
select gen_random_uuid(),'${slug}','${title}','imported','${gtype}','${table}',
  jsonb_build_object('color','${color}','kind','fill','extent',
    (select jsonb_build_array(round(st_xmin(e)::numeric,4),round(st_ymin(e)::numeric,4),
                              round(st_xmax(e)::numeric,4),round(st_ymax(e)::numeric,4))
     from (select st_extent(geom) e from gis.${table}) x)),
  6, 'Импортировано из КАРТА ЧС 2024';
commit;
SQL
}

# Glacier inventory (6238 polygons) — GLOF-risk context.
import_layer "ledniki" "Ледники" "MultiPolygon" "#67b7dc" \
  'SELECT ID AS glacier_id, name_rus, name_eng, activ, Area AS area_km2 FROM "Ледник"'

echo "load-map-layers: done."
psql "$DATABASE_URL" -tAc "select slug, geometry_type, (select count(*) from gis.l_ledniki) as features from gis.layers where kind='imported' order by slug;"
