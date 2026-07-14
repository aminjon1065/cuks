#!/usr/bin/env bash
#
# build-basemap.sh — build the offline vector basemap (Protomaps PMTiles) for the
# region (docs/02 ADR-12, docs/modules/10 §4). Extracts ONLY the region's tiles
# from the hosted Protomaps planet build using the `pmtiles` CLI — it does not
# download the whole planet, just the bbox (a country is ~tens–hundreds of MB).
#
# Output: infra/basemap/region.pmtiles — Martin serves it as source "region", and
# the map's «Схема» / «Тёмная» styles reference it. Everything works fully offline
# afterward (no external tile servers, docs/02 ADR-12).
#
# Requirements: the `pmtiles` CLI (https://github.com/protomaps/go-pmtiles).
# Pick a current planet build from https://maps.protomaps.com/builds and pass it
# as PLANET_URL. BBOX defaults to Tajikistan + margin.
#
# Usage:
#   PLANET_URL=https://build.protomaps.com/YYYYMMDD.pmtiles ./infra/scripts/build-basemap.sh
#
set -euo pipefail

PLANET_URL="${PLANET_URL:?set PLANET_URL to a Protomaps planet build (https://maps.protomaps.com/builds)}"
BBOX="${BBOX:-67.0,36.5,75.5,41.2}" # Tajikistan + margin (minlon,minlat,maxlon,maxlat)
OUT="$(cd "$(dirname "$0")/../basemap" && pwd)/region.pmtiles"

if ! command -v pmtiles >/dev/null 2>&1; then
  echo "pmtiles CLI is required — install from https://github.com/protomaps/go-pmtiles" >&2
  exit 1
fi

echo "build-basemap: extracting bbox ${BBOX} from ${PLANET_URL} → ${OUT}"
pmtiles extract "$PLANET_URL" "$OUT" --bbox="$BBOX"
echo "build-basemap: done."
# `|| true`: `head` closing the pipe early gives pmtiles a SIGPIPE (exit 141),
# which `set -o pipefail` would otherwise turn into a false failure.
pmtiles show "$OUT" | head -n 20 || true
