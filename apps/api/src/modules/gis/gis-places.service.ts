import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { adminUnits, facilities, type Database } from '@cuks/db';
import type { GisPlaceHitDto, GisPlacesSearchQuery, GisPlacesSearchResponse } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

/**
 * Map place search (docs/modules/10 §4): geocode against our own data —
 * administrative units and facilities. Coordinate parsing lives on the client;
 * this service only resolves named places to a WGS84 bounds + center.
 */
@Injectable()
export class GisPlacesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async search(query: GisPlacesSearchQuery): Promise<GisPlacesSearchResponse> {
    const pattern = `%${escapeLike(query.q)}%`;
    const limit = query.limit;

    const [units, places] = await Promise.all([
      this.db
        .select({
          id: adminUnits.id,
          level: adminUnits.level,
          nameRu: adminUnits.nameRu,
          nameTg: adminUnits.nameTg,
          code: adminUnits.code,
          west: sql<number>`ST_XMin(${adminUnits.geom})`,
          south: sql<number>`ST_YMin(${adminUnits.geom})`,
          east: sql<number>`ST_XMax(${adminUnits.geom})`,
          north: sql<number>`ST_YMax(${adminUnits.geom})`,
          lon: sql<number>`ST_X(ST_PointOnSurface(${adminUnits.geom}))`,
          lat: sql<number>`ST_Y(ST_PointOnSurface(${adminUnits.geom}))`,
        })
        .from(adminUnits)
        .where(
          or(
            ilike(adminUnits.nameRu, pattern),
            ilike(adminUnits.nameTg, pattern),
            ilike(adminUnits.code, pattern),
          ),
        )
        .orderBy(
          sql`case ${adminUnits.level} when 'region' then 0 when 'district' then 1 else 2 end`,
          asc(adminUnits.nameRu),
        )
        .limit(limit),
      this.db
        .select({
          id: facilities.id,
          name: facilities.name,
          kind: facilities.kind,
          lon: sql<number>`ST_X(${facilities.geom})`,
          lat: sql<number>`ST_Y(${facilities.geom})`,
        })
        .from(facilities)
        .where(and(eq(facilities.isActive, true), ilike(facilities.name, pattern)))
        .orderBy(asc(facilities.name))
        .limit(limit),
    ]);

    const items: GisPlaceHitDto[] = [
      ...units.map((row): GisPlaceHitDto => ({
        kind: 'admin_unit',
        id: row.id,
        label: row.nameRu,
        level: row.level,
        bounds: [row.west, row.south, row.east, row.north],
        center: [row.lon, row.lat],
      })),
      ...places.map((row): GisPlaceHitDto => {
        const pad = 0.02;
        return {
          kind: 'facility',
          id: row.id,
          label: row.name,
          bounds: [row.lon - pad, row.lat - pad, row.lon + pad, row.lat + pad],
          center: [row.lon, row.lat],
        };
      }),
    ];

    // Prefer admin units (regions/districts) when the query matches both.
    items.sort((a, b) => {
      const rank = (hit: GisPlaceHitDto): number => {
        if (hit.kind === 'admin_unit') {
          if (hit.level === 'region') return 0;
          if (hit.level === 'district') return 1;
          return 2;
        }
        return 3;
      };
      return rank(a) - rank(b) || a.label.localeCompare(b.label, 'ru');
    });

    return { items: items.slice(0, limit) };
  }
}

/** Escape `%` / `_` so a user query is matched literally under ILIKE. */
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
