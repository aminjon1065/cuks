import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { gisLayers, resourceAcl, type Database } from '@cuks/db';
import {
  aclLevelSatisfies,
  slugify,
  type AclLevel,
  type CreateGisLayerInput,
  type GisLayerDto,
  type PatchGisLayerInput,
} from '@cuks/shared';
import { AclService } from '../admin/acl.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';

type GisLayer = typeof gisLayers.$inferSelect;

/** How many times a create retries when a concurrent create steals its slug. */
const SLUG_ATTEMPTS = 3;
/** Upper bound of the `slug-2`, `slug-3`… suffix search. */
const SLUG_MAX = 50;

/** Postgres unique-violation (a concurrent create took the slug first). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Re-exported: the geo-import worker (2.8) derives an imported layer's slug — and
 *  its physical table name — with the same function (`@cuks/shared`). */
export { slugify };

/**
 * Layer registry (docs/modules/10 §3/§9, task 2.7). Phase 2.7 manages `drawn`
 * layers — the web-drawn annotation layers whose features live in
 * gis.layer_features. Write access is per-layer ACL (`resource_acl`,
 * resource_type `layer`): the creator gets `manager`; holders of
 * `gis.layers.manage` may manage any layer. Reading the registry needs only
 * `gis.view` (the tile source is likewise open — see STATUS 2.7 decision).
 */
@Injectable()
export class GisLayersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: AclService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser): Promise<GisLayerDto[]> {
    const rows = await this.db
      .select()
      .from(gisLayers)
      .where(isNull(gisLayers.deletedAt))
      .orderBy(gisLayers.createdAt);
    if (rows.length === 0) return [];

    const levels = await this.levelsFor(
      user,
      rows.map((r) => r.id),
    );
    const canManageAll = user.isSuperadmin || user.permissions.includes('gis.layers.manage');
    return rows.map((row) => this.toDto(row, levels.get(row.id) ?? null, canManageAll));
  }

  /**
   * The layer row and the creator's `manager` grant are one transaction: a layer
   * that survived a failed grant would be editable by nobody (its creator
   * included) and undeletable through the API. The slug is resolved inside the
   * same transaction and retried on a unique violation, so two people creating
   * "Оцепление" at once get `oceplenie` and `oceplenie-2` rather than a 500.
   */
  async create(input: CreateGisLayerInput, user: AuthUser): Promise<GisLayerDto> {
    const base = slugify(input.title);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      try {
        const created = await this.db.transaction(async (tx) => {
          const slug = await this.uniqueSlug(base, tx);
          const [row] = await tx
            .insert(gisLayers)
            .values({
              slug,
              title: input.title,
              kind: 'drawn',
              geometryType: input.geometryType,
              style: input.style,
              ...(input.description ? { description: input.description } : {}),
              createdBy: user.id,
            })
            .returning();

          // The creator manages their own layer (mirrors the files-module convention).
          await this.acl.grant(
            {
              resourceType: 'layer',
              resourceId: row!.id,
              subjectType: 'user',
              subjectId: user.id,
              level: 'manager',
            },
            user.id,
            tx,
          );
          return row!;
        });

        this.audit.log({
          action: 'gis.layer.created',
          actorId: user.id,
          entityType: 'layer',
          entityId: created.id,
          meta: { slug: created.slug, kind: 'drawn', geometryType: input.geometryType },
        });
        return this.toDto(created, 'manager', user.isSuperadmin);
      } catch (error) {
        // A concurrent create took the slug between our SELECT and INSERT.
        if (!isUniqueViolation(error) || attempt === SLUG_ATTEMPTS - 1) throw error;
      }
    }
    // Unreachable: the loop either returns or rethrows on its last attempt.
    throw AppException.conflict('gis.layer.slug_conflict', 'Could not allocate a layer slug');
  }

  async patch(id: string, input: PatchGisLayerInput, user: AuthUser): Promise<GisLayerDto> {
    const layer = await this.requireLayer(id);
    await this.assertManage(layer, user);

    const [updated] = await this.db
      .update(gisLayers)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.style !== undefined ? { style: input.style } : {}),
        updatedAt: new Date(),
      })
      .where(eq(gisLayers.id, id))
      .returning();

    this.audit.log({
      action: 'gis.layer.updated',
      actorId: user.id,
      entityType: 'layer',
      entityId: id,
      meta: { fields: Object.keys(input) },
    });
    return this.toDto(updated!, 'manager', user.isSuperadmin);
  }

  /**
   * Soft-delete: the partial unique index frees the slug for reuse. An imported
   * layer's physical table (`gis.l_<slug>`) is deliberately left in place — the row
   * is only soft-deleted (CLAUDE.md §2), the tiles stop serving it (the tile
   * function filters `deleted_at`), and dropping the table is a retention decision,
   * not a click (QGIS may be reading it — docs/modules/10 §7).
   */
  async remove(id: string, user: AuthUser): Promise<void> {
    const layer = await this.requireLayer(id);
    await this.assertManage(layer, user);
    await this.db.update(gisLayers).set({ deletedAt: new Date() }).where(eq(gisLayers.id, id));
    this.audit.log({
      action: 'gis.layer.deleted',
      actorId: user.id,
      entityType: 'layer',
      entityId: id,
      meta: { slug: layer.slug, kind: layer.kind, tableName: layer.tableName },
    });
  }

  async requireLayer(id: string): Promise<GisLayer> {
    const [layer] = await this.db
      .select()
      .from(gisLayers)
      .where(and(eq(gisLayers.id, id), isNull(gisLayers.deletedAt)))
      .limit(1);
    if (!layer) throw AppException.notFound('gis.layer.not_found', 'Layer not found');
    return layer;
  }

  /**
   * Access to the *objects* of a layer (drawing, editing, deleting features). Only
   * a `drawn` layer has objects that are editable here: an imported one is a
   * snapshot of a file (re-import it to change it), and a system layer is not ours
   * to touch.
   */
  async assertAccess(layer: GisLayer, user: AuthUser, minLevel: AclLevel): Promise<void> {
    if (layer.kind !== 'drawn') {
      throw AppException.badRequest(
        'gis.layer.not_editable',
        'Only drawn layers can be edited here',
      );
    }
    await this.assertLevel(layer, user, minLevel);
  }

  /**
   * Access to the *layer itself* (rename, restyle, delete). This covers imported
   * layers too (task 2.8) — a wrongly imported file has to be removable, and its
   * importer is its manager. System layers stay off-limits.
   */
  async assertManage(layer: GisLayer, user: AuthUser): Promise<void> {
    if (layer.kind === 'system') {
      throw AppException.badRequest(
        'gis.layer.not_editable',
        'System layers cannot be changed here',
      );
    }
    await this.assertLevel(layer, user, 'manager');
  }

  /** Superadmin and `gis.layers.manage` holders bypass the per-layer ACL. */
  private async assertLevel(layer: GisLayer, user: AuthUser, minLevel: AclLevel): Promise<void> {
    if (user.isSuperadmin || user.permissions.includes('gis.layers.manage')) return;
    if (await this.acl.check(user, 'layer', layer.id, minLevel)) return;
    throw AppException.forbidden('gis.layer.access_denied', 'No access to this layer');
  }

  /** Highest ACL level the user holds on each of `layerIds`, in one query. */
  private async levelsFor(user: AuthUser, layerIds: string[]): Promise<Map<string, AclLevel>> {
    const out = new Map<string, AclLevel>();
    if (user.isSuperadmin || layerIds.length === 0) return out;

    const { roleIds, orgUnitIds } = await this.acl.resolveUserSubjects(user.id);
    const subjects: SQL[] = [
      and(eq(resourceAcl.subjectType, 'user'), eq(resourceAcl.subjectId, user.id)) as SQL,
    ];
    if (roleIds.length) {
      subjects.push(
        and(eq(resourceAcl.subjectType, 'role'), inArray(resourceAcl.subjectId, roleIds)) as SQL,
      );
    }
    if (orgUnitIds.length) {
      subjects.push(
        and(
          eq(resourceAcl.subjectType, 'org_unit'),
          inArray(resourceAcl.subjectId, orgUnitIds),
        ) as SQL,
      );
    }

    const rows = await this.db
      .select({ resourceId: resourceAcl.resourceId, level: resourceAcl.level })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, 'layer'),
          inArray(resourceAcl.resourceId, layerIds),
          or(...subjects),
        ),
      );
    for (const row of rows) {
      const current = out.get(row.resourceId);
      if (!current || aclLevelSatisfies(row.level, current)) out.set(row.resourceId, row.level);
    }
    return out;
  }

  /** First free `slug`, `slug-2`, `slug-3`… The partial unique index only covers
   *  live rows, so a soft-deleted layer frees its slug for reuse. */
  private async uniqueSlug(base: string, tx: Database): Promise<string> {
    const taken = await tx
      .select({ slug: gisLayers.slug })
      .from(gisLayers)
      .where(and(like(gisLayers.slug, `${base}%`), isNull(gisLayers.deletedAt)));
    const used = new Set(taken.map((row) => row.slug));
    if (!used.has(base)) return base;
    for (let i = 2; i <= SLUG_MAX; i++) {
      const candidate = `${base}-${i}`;
      if (!used.has(candidate)) return candidate;
    }
    throw AppException.conflict('gis.layer.slug_conflict', 'Too many layers with this title');
  }

  private toDto(row: GisLayer, level: AclLevel | null, elevated: boolean): GisLayerDto {
    const manages = elevated || (level !== null && aclLevelSatisfies(level, 'manager'));
    // `canEdit` is about the layer's *objects* (drawn only); `canManage` is about the
    // layer itself, which includes an imported one — it has to be removable.
    const canManage = manages && row.kind !== 'system';
    const canEdit =
      row.kind === 'drawn' && (manages || (level !== null && aclLevelSatisfies(level, 'editor')));
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      geometryType: row.geometryType,
      style: (row.style ?? {}) as Record<string, unknown>,
      description: row.description,
      minZoom: row.minZoom,
      maxZoom: row.maxZoom,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canEdit,
      canManage,
    };
  }
}
