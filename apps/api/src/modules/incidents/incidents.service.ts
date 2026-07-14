import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  adminUnits,
  auditLog,
  dictionaries,
  incidentReports,
  incidentResources,
  incidents,
  savedFilters,
  users,
  type Database,
} from '@cuks/db';
import {
  INCIDENT_NUMBER_PREFIX,
  type CreateIncidentInput,
  type CreateIncidentReportInput,
  type CreateIncidentResourceInput,
  type CreateSavedIncidentFilterInput,
  type IncidentDetailDto,
  type IncidentListItemDto,
  type IncidentRegistryFilters,
  type IncidentResourceDto,
  type IncidentStatus,
  type ListIncidentsQuery,
  type PaginatedResult,
  type SavedIncidentFilterDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { RealtimeService } from '../events/realtime.service';
import { wsRooms } from '@cuks/shared';
import { buildIncidentXlsx, type IncidentExportRow } from './incident-xlsx';

const INCIDENT_FILTER_MODULE = 'incidents';
const INCIDENT_EXPORT_LIMIT = 10_000;

interface RegistryRow {
  id: string;
  number: string;
  typeCode: string;
  severity: number;
  status: IncidentStatus;
  occurredAt: Date;
  reportedAt: Date;
  regionId: string | null;
  districtId: string | null;
  dead: number;
  injured: number;
  evacuated: number;
  affected: number;
  damageEst: string | null;
  damageNote: string | null;
  addressText: string | null;
  description: string | null;
  source: IncidentDetailDto['source'];
  createdBy: string | null;
  longitude: number;
  latitude: number;
}

interface TerritoryIds {
  regionId: string | null;
  districtId: string | null;
  jamoatId: string | null;
}

export function nextIncidentNumber(year: number, previousSequence: number): string {
  return `${INCIDENT_NUMBER_PREFIX}-${year}-${String(previousSequence + 1).padStart(4, '0')}`;
}

export function mergeReportSnapshot(
  incident: Pick<
    typeof incidents.$inferSelect,
    'dead' | 'injured' | 'evacuated' | 'affected' | 'damageEst' | 'damageNote'
  >,
  input: CreateIncidentReportInput,
) {
  return {
    dead: input.dead ?? incident.dead,
    injured: input.injured ?? incident.injured,
    evacuated: input.evacuated ?? incident.evacuated,
    affected: input.affected ?? incident.affected,
    damageEst: input.damageEst ?? incident.damageEst,
    damageNote: input.damageNote ?? incident.damageNote,
  };
}

export function isSelectableIncidentType(
  type: { code: string } | undefined,
  child: { code: string } | undefined,
): boolean {
  return !!type && !child;
}

/** Registry, report chronology and resources (docs/modules/10 §5). */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListIncidentsQuery): Promise<PaginatedResult<IncidentListItemDto>> {
    const filters = this.whereFor(query);
    const where = and(...filters);
    const [totalRows, rows] = await Promise.all([
      this.db.select({ total: count() }).from(incidents).where(where),
      this.findRegistryRows(query, where, query.limit, (query.page - 1) * query.limit),
    ]);
    return {
      items: await this.toListItems(rows),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async detail(id: string): Promise<IncidentDetailDto> {
    const [row] = await this.baseSelect()
      .where(and(eq(incidents.id, id), isNull(incidents.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('incidents.incident.not_found', 'Incident not found');

    const [listItem] = await this.toListItems([row]);
    if (!listItem) throw new Error('Incident label hydration failed');
    const [reports, resources, events] = await Promise.all([
      this.db
        .select({
          id: incidentReports.id,
          reportedAt: incidentReports.reportedAt,
          text: incidentReports.text,
          dead: incidentReports.dead,
          injured: incidentReports.injured,
          evacuated: incidentReports.evacuated,
          affected: incidentReports.affected,
          damageEst: incidentReports.damageEst,
          damageNote: incidentReports.damageNote,
          authorName: users.shortName,
        })
        .from(incidentReports)
        .leftJoin(users, eq(users.id, incidentReports.authorId))
        .where(eq(incidentReports.incidentId, id))
        .orderBy(desc(incidentReports.reportedAt)),
      this.db
        .select({
          id: incidentResources.id,
          kind: incidentResources.kind,
          name: incidentResources.name,
          qty: incidentResources.qty,
          orgText: incidentResources.orgText,
          period: incidentResources.period,
          createdAt: incidentResources.createdAt,
        })
        .from(incidentResources)
        .where(eq(incidentResources.incidentId, id))
        .orderBy(desc(incidentResources.createdAt)),
      this.db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          createdAt: auditLog.createdAt,
          actorName: users.shortName,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(and(eq(auditLog.entityType, 'incident'), eq(auditLog.entityId, id)))
        .orderBy(desc(auditLog.createdAt)),
    ]);

    return {
      ...listItem,
      reportedAt: row.reportedAt.toISOString(),
      addressText: row.addressText,
      description: row.description,
      source: row.source,
      evacuated: row.evacuated,
      affected: row.affected,
      damageNote: row.damageNote,
      location: { longitude: Number(row.longitude), latitude: Number(row.latitude) },
      reports: reports.map((report) => ({
        ...report,
        reportedAt: report.reportedAt.toISOString(),
        authorName: report.authorName ?? null,
      })),
      resources: resources.map((resource): IncidentResourceDto => ({
        ...resource,
        createdAt: resource.createdAt.toISOString(),
      })),
      events: events.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        actorName: event.actorName ?? null,
      })),
    };
  }

  async create(input: CreateIncidentInput, actor: AuthUser): Promise<IncidentDetailDto> {
    await this.assertLeafType(input.typeCode);
    const occurredAt = new Date(input.occurredAt);
    const reportedAt = new Date();
    if (occurredAt > reportedAt) {
      throw AppException.unprocessable(
        'incidents.occurrence.in_future',
        'An incident occurrence cannot be after its first report',
      );
    }
    const territory = await this.resolveTerritory(
      input.location.longitude,
      input.location.latitude,
    );
    const incidentId = await this.db.transaction(async (tx) => {
      // One transaction-scoped advisory lock per incident year makes the human
      // number deterministic under simultaneous operator reports.
      const year = occurredAt.getUTCFullYear();
      await tx.execute(sql`select pg_advisory_xact_lock(${4_250_000 + year})`);
      const sequenceResult = await tx.execute<{ max_sequence: number | null }>(sql`
        select max(substring(number from ${`^${INCIDENT_NUMBER_PREFIX}-${year}-([0-9]+)$`})::integer) as max_sequence
        from app.incidents
      `);
      const number = nextIncidentNumber(year, Number(sequenceResult.rows[0]?.max_sequence ?? 0));
      const [created] = await tx
        .insert(incidents)
        .values({
          number,
          typeCode: input.typeCode,
          severity: input.severity,
          occurredAt,
          reportedAt,
          regionId: territory.regionId,
          districtId: territory.districtId,
          jamoatId: territory.jamoatId,
          geom: sql`ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326)`,
          addressText: input.addressText ?? null,
          description: input.description ?? null,
          source: input.source,
          dead: input.dead,
          injured: input.injured,
          evacuated: input.evacuated,
          affected: input.affected,
          damageEst: input.damageEst ?? null,
          damageNote: input.damageNote ?? null,
          createdBy: actor.id,
        })
        .returning({ id: incidents.id });
      if (!created) throw new Error('Incident insert did not return an id');
      await tx.insert(incidentReports).values({
        incidentId: created.id,
        reportedAt,
        text: input.description ?? null,
        dead: input.dead,
        injured: input.injured,
        evacuated: input.evacuated,
        affected: input.affected,
        damageEst: input.damageEst ?? null,
        damageNote: input.damageNote ?? null,
        authorId: actor.id,
      });
      return created.id;
    });
    this.audit.log({
      action: 'incident.created',
      entityType: 'incident',
      entityId: incidentId,
      meta: { typeCode: input.typeCode, severity: input.severity },
    });
    this.publishUpdate(incidentId, 'created');
    return this.detail(incidentId);
  }

  async addReport(
    id: string,
    input: CreateIncidentReportInput,
    actor: AuthUser,
  ): Promise<IncidentDetailDto> {
    await this.db.transaction(async (tx) => {
      const [incident] = await tx
        .select()
        .from(incidents)
        .where(and(eq(incidents.id, id), isNull(incidents.deletedAt)))
        .limit(1)
        .for('update');
      if (!incident) {
        throw AppException.notFound('incidents.incident.not_found', 'Incident not found');
      }
      const reportedAt = input.reportedAt
        ? new Date(input.reportedAt)
        : new Date(Math.max(Date.now(), incident.reportedAt.getTime() + 1));
      if (reportedAt < incident.occurredAt) {
        throw AppException.unprocessable(
          'incidents.report.before_occurrence',
          'A report cannot predate the incident occurrence',
        );
      }
      if (reportedAt <= incident.reportedAt) {
        throw AppException.unprocessable(
          'incidents.report.not_after_latest',
          'A report must be after the latest confirmed report',
        );
      }
      const snapshot = mergeReportSnapshot(incident, input);
      await tx.insert(incidentReports).values({
        incidentId: id,
        reportedAt,
        text: input.text ?? null,
        ...snapshot,
        authorId: actor.id,
      });
      await tx
        .update(incidents)
        .set({ ...snapshot, reportedAt })
        .where(eq(incidents.id, id));
    });
    this.audit.log({
      action: 'incident.updated',
      entityType: 'incident',
      entityId: id,
      meta: { report: true },
    });
    this.publishUpdate(id, 'reported');
    return this.detail(id);
  }

  async addResource(id: string, input: CreateIncidentResourceInput): Promise<IncidentDetailDto> {
    await this.requireIncident(id);
    await this.db.insert(incidentResources).values({ incidentId: id, ...input });
    this.audit.log({
      action: 'incident.updated',
      entityType: 'incident',
      entityId: id,
      meta: { resource: input.kind },
    });
    this.publishUpdate(id, 'resource_added');
    return this.detail(id);
  }

  async listSavedFilters(userId: string): Promise<SavedIncidentFilterDto[]> {
    const rows = await this.db
      .select({
        id: savedFilters.id,
        name: savedFilters.name,
        params: savedFilters.params,
        createdAt: savedFilters.createdAt,
      })
      .from(savedFilters)
      .where(
        and(
          eq(savedFilters.userId, userId),
          eq(savedFilters.module, INCIDENT_FILTER_MODULE),
          isNull(savedFilters.deletedAt),
        ),
      )
      .orderBy(asc(savedFilters.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      params: row.params as IncidentRegistryFilters,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveFilter(
    userId: string,
    input: CreateSavedIncidentFilterInput,
  ): Promise<SavedIncidentFilterDto> {
    const [created] = await this.db
      .insert(savedFilters)
      .values({ userId, module: INCIDENT_FILTER_MODULE, name: input.name, params: input.params })
      .returning();
    if (!created) throw new Error('Saved filter insert did not return a row');
    return {
      id: created.id,
      name: created.name,
      params: input.params,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async removeSavedFilter(id: string, userId: string): Promise<void> {
    const [removed] = await this.db
      .update(savedFilters)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(savedFilters.id, id),
          eq(savedFilters.userId, userId),
          eq(savedFilters.module, INCIDENT_FILTER_MODULE),
          isNull(savedFilters.deletedAt),
        ),
      )
      .returning({ id: savedFilters.id });
    if (!removed)
      throw AppException.notFound('incidents.saved_filter.not_found', 'Saved filter not found');
  }

  async exportXlsx(filters: IncidentRegistryFilters): Promise<Buffer> {
    const query = { ...filters, sort: '-occurredAt' as const };
    const rows = await this.findRegistryRows(
      query,
      and(...this.whereFor(query)),
      INCIDENT_EXPORT_LIMIT,
      0,
    );
    const items = await this.toListItems(rows);
    const exportRows: IncidentExportRow[] = [
      [
        '№',
        'Дата',
        'Вид',
        'Уровень',
        'Регион',
        'Район',
        'Статус',
        'Погибшие',
        'Пострадавшие',
        'Ущерб',
      ],
      ...items.map((item) => [
        item.number,
        item.occurredAt,
        item.typeName,
        item.severity,
        item.regionName ?? '',
        item.districtName ?? '',
        item.status,
        item.dead,
        item.injured,
        item.damageEst ?? '',
      ]),
    ];
    return buildIncidentXlsx(exportRows);
  }

  private whereFor(filters: IncidentRegistryFilters): SQL[] {
    const where: SQL[] = [isNull(incidents.deletedAt)];
    if (filters.from) where.push(gte(incidents.occurredAt, new Date(filters.from)));
    if (filters.to) where.push(lte(incidents.occurredAt, new Date(filters.to)));
    if (filters.typeCode) where.push(eq(incidents.typeCode, filters.typeCode));
    if (filters.severity) where.push(eq(incidents.severity, filters.severity));
    if (filters.status) where.push(eq(incidents.status, filters.status));
    if (filters.regionId) where.push(eq(incidents.regionId, filters.regionId));
    if (filters.search) {
      const text = `%${filters.search}%`;
      const condition = or(
        ilike(incidents.number, text),
        ilike(incidents.description, text),
        ilike(incidents.addressText, text),
      );
      if (condition) where.push(condition);
    }
    return where;
  }

  private baseSelect() {
    return this.db
      .select({
        id: incidents.id,
        number: incidents.number,
        typeCode: incidents.typeCode,
        severity: incidents.severity,
        status: incidents.status,
        occurredAt: incidents.occurredAt,
        reportedAt: incidents.reportedAt,
        regionId: incidents.regionId,
        districtId: incidents.districtId,
        dead: incidents.dead,
        injured: incidents.injured,
        evacuated: incidents.evacuated,
        affected: incidents.affected,
        damageEst: incidents.damageEst,
        damageNote: incidents.damageNote,
        addressText: incidents.addressText,
        description: incidents.description,
        source: incidents.source,
        createdBy: incidents.createdBy,
        longitude: sql<number>`ST_X(${incidents.geom})`,
        latitude: sql<number>`ST_Y(${incidents.geom})`,
      })
      .from(incidents);
  }

  private findRegistryRows(
    query: Pick<ListIncidentsQuery, 'sort'>,
    where: SQL | undefined,
    limit: number,
    offset: number,
  ): Promise<RegistryRow[]> {
    const select = this.baseSelect().where(where);
    if (query.sort === 'occurredAt')
      return select
        .orderBy(asc(incidents.occurredAt), asc(incidents.id))
        .limit(limit)
        .offset(offset);
    if (query.sort === 'reportedAt')
      return select
        .orderBy(asc(incidents.reportedAt), asc(incidents.id))
        .limit(limit)
        .offset(offset);
    if (query.sort === '-reportedAt')
      return select
        .orderBy(desc(incidents.reportedAt), desc(incidents.id))
        .limit(limit)
        .offset(offset);
    if (query.sort === 'number')
      return select.orderBy(asc(incidents.number)).limit(limit).offset(offset);
    if (query.sort === '-number')
      return select.orderBy(desc(incidents.number)).limit(limit).offset(offset);
    return select
      .orderBy(desc(incidents.occurredAt), desc(incidents.id))
      .limit(limit)
      .offset(offset);
  }

  private async toListItems(rows: RegistryRow[]): Promise<IncidentListItemDto[]> {
    const typeCodes = [...new Set(rows.map((row) => row.typeCode))];
    const unitIds = [
      ...new Set(
        rows.flatMap((row) => [row.regionId, row.districtId]).filter((id): id is string => !!id),
      ),
    ];
    const userIds = [
      ...new Set(rows.map((row) => row.createdBy).filter((id): id is string => !!id)),
    ];
    const [types, units, owners] = await Promise.all([
      typeCodes.length
        ? this.db
            .select({ code: dictionaries.code, nameRu: dictionaries.nameRu })
            .from(dictionaries)
            .where(
              and(eq(dictionaries.type, 'incident_type'), inArray(dictionaries.code, typeCodes)),
            )
        : Promise.resolve([]),
      unitIds.length
        ? this.db
            .select({ id: adminUnits.id, nameRu: adminUnits.nameRu })
            .from(adminUnits)
            .where(inArray(adminUnits.id, unitIds))
        : Promise.resolve([]),
      userIds.length
        ? this.db
            .select({ id: users.id, shortName: users.shortName })
            .from(users)
            .where(inArray(users.id, userIds))
        : Promise.resolve([]),
    ]);
    const typeNames = new Map(types.map((type) => [type.code, type.nameRu]));
    const unitNames = new Map(units.map((unit) => [unit.id, unit.nameRu]));
    const ownerNames = new Map(owners.map((owner) => [owner.id, owner.shortName]));
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      typeCode: row.typeCode,
      typeName: typeNames.get(row.typeCode) ?? row.typeCode,
      severity: row.severity as IncidentListItemDto['severity'],
      status: row.status,
      occurredAt: row.occurredAt.toISOString(),
      regionName: row.regionId ? (unitNames.get(row.regionId) ?? null) : null,
      districtName: row.districtId ? (unitNames.get(row.districtId) ?? null) : null,
      dead: row.dead,
      injured: row.injured,
      damageEst: row.damageEst,
      ownerName: row.createdBy ? (ownerNames.get(row.createdBy) ?? null) : null,
    }));
  }

  private async assertLeafType(typeCode: string): Promise<void> {
    const [[type], [child]] = await Promise.all([
      this.db
        .select({ code: dictionaries.code })
        .from(dictionaries)
        .where(
          and(
            eq(dictionaries.type, 'incident_type'),
            eq(dictionaries.code, typeCode),
            eq(dictionaries.isActive, true),
          ),
        )
        .limit(1),
      this.db
        .select({ code: dictionaries.code })
        .from(dictionaries)
        .where(
          and(
            eq(dictionaries.type, 'incident_type'),
            eq(dictionaries.parentCode, typeCode),
            eq(dictionaries.isActive, true),
          ),
        )
        .limit(1),
    ]);
    if (!isSelectableIncidentType(type, child)) {
      throw AppException.unprocessable(
        'incidents.type.invalid',
        'Incident type must be an active leaf',
      );
    }
  }

  private async resolveTerritory(longitude: number, latitude: number): Promise<TerritoryIds> {
    const result = await this.db.execute<{
      id: string;
      level: 'region' | 'district' | 'jamoat';
    }>(sql`
      select id, level
      from gis.admin_units
      where ST_Covers(geom, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
    `);
    const territory: TerritoryIds = { regionId: null, districtId: null, jamoatId: null };
    for (const row of result.rows) {
      if (row.level === 'region') territory.regionId = row.id;
      if (row.level === 'district') territory.districtId = row.id;
      if (row.level === 'jamoat') territory.jamoatId = row.id;
    }
    return territory;
  }

  private async requireIncident(id: string): Promise<typeof incidents.$inferSelect> {
    const [incident] = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.id, id), isNull(incidents.deletedAt)))
      .limit(1);
    if (!incident)
      throw AppException.notFound('incidents.incident.not_found', 'Incident not found');
    return incident;
  }

  private publishUpdate(id: string, action: 'created' | 'reported' | 'resource_added'): void {
    this.realtime.emitToRoom(wsRooms.gis(), 'incidents.updated', { id, action });
  }
}
