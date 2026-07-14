import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { gisLayers, resourceAcl, type Database } from '@cuks/db';
import {
  aclLevelSatisfies,
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

// Russian + the six Tajik-specific letters (ғ ӣ қ ӯ ҳ ҷ) — a Tajik title must not
// lose characters on its way to the slug (docs/04 §i18n: both languages are first
// class, only the identifiers are English).
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'gh',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  ӣ: 'i',
  й: 'i',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ӯ: 'u',
  ф: 'f',
  х: 'h',
  ҳ: 'h',
  ц: 'c',
  ч: 'ch',
  ҷ: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** How many times a create retries when a concurrent create steals its slug. */
const SLUG_ATTEMPTS = 3;
/** Upper bound of the `slug-2`, `slug-3`… suffix search. */
const SLUG_MAX = 50;

/** Postgres unique-violation (a concurrent create took the slug first). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** URL-safe slug from a (usually Russian or Tajik) title — layers are addressed by
 *  slug in the tile/WMS surface, so it must be ASCII. */
export function slugify(title: string): string {
  const latin = [...title.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('');
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'layer';
}

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
    await this.assertAccess(layer, user, 'manager');

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

  /** Soft-delete: the partial unique index frees the slug for reuse. */
  async remove(id: string, user: AuthUser): Promise<void> {
    const layer = await this.requireLayer(id);
    await this.assertAccess(layer, user, 'manager');
    await this.db.update(gisLayers).set({ deletedAt: new Date() }).where(eq(gisLayers.id, id));
    this.audit.log({
      action: 'gis.layer.deleted',
      actorId: user.id,
      entityType: 'layer',
      entityId: id,
      meta: { slug: layer.slug },
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

  /** Superadmin and `gis.layers.manage` holders bypass the per-layer ACL; system
   *  layers (admin_units/incidents/…) are never editable through this surface. */
  async assertAccess(layer: GisLayer, user: AuthUser, minLevel: AclLevel): Promise<void> {
    if (layer.kind !== 'drawn') {
      throw AppException.badRequest(
        'gis.layer.not_editable',
        'Only drawn layers can be edited here',
      );
    }
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
    const canManage = elevated || (level !== null && aclLevelSatisfies(level, 'manager'));
    const canEdit =
      row.kind === 'drawn' && (canManage || (level !== null && aclLevelSatisfies(level, 'editor')));
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
      canManage: canManage && row.kind === 'drawn',
    };
  }
}
