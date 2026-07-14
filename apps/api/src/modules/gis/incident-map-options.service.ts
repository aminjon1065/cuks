import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { adminUnits, dictionaries, type Database } from '@cuks/db';
import type { IncidentMapFilterOptionsResponse, IncidentTypeFilterOption } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

/** Reference data for the operational incident layer. Only leaf incident types
 * are selectable because the MVT function filters by an exact stable code. */
@Injectable()
export class IncidentMapOptionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getOptions(): Promise<IncidentMapFilterOptionsResponse> {
    const [typeRows, regions] = await Promise.all([
      this.db
        .select({
          code: dictionaries.code,
          parentCode: dictionaries.parentCode,
          nameRu: dictionaries.nameRu,
          nameTg: dictionaries.nameTg,
        })
        .from(dictionaries)
        .where(and(eq(dictionaries.type, 'incident_type'), eq(dictionaries.isActive, true)))
        .orderBy(asc(dictionaries.sort), asc(dictionaries.code)),
      this.db
        .select({
          id: adminUnits.id,
          code: adminUnits.code,
          nameRu: adminUnits.nameRu,
          nameTg: adminUnits.nameTg,
        })
        .from(adminUnits)
        .where(eq(adminUnits.level, 'region'))
        .orderBy(asc(adminUnits.nameRu)),
    ]);

    const parentByCode = new Map(typeRows.map((row) => [row.code, row]));
    const codesWithChildren = new Set(
      typeRows.map((row) => row.parentCode).filter((code): code is string => code !== null),
    );
    const types: IncidentTypeFilterOption[] = typeRows
      .filter((row) => !codesWithChildren.has(row.code))
      .map((row) => {
        const parent = row.parentCode ? parentByCode.get(row.parentCode) : undefined;
        return {
          ...row,
          parentNameRu: parent?.nameRu ?? null,
          parentNameTg: parent?.nameTg ?? null,
        };
      });

    return { types, regions };
  }
}
