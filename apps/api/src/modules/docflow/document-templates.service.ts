import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  documentTemplateVersions,
  documentTemplates,
  documents,
  orgUnits,
  users,
  type Database,
} from '@cuks/db';
import {
  collectTemplateVariables,
  documentContentText,
  renderTemplateContent,
  type CreateDocumentTemplateInput,
  type CreateTemplateVersionInput,
  type DocumentContent,
  type DocumentTemplateDto,
  type DocumentTemplateVersionDto,
  type InstantiateDocumentTemplateInput,
  type TemplateContext,
  type UpdateDocumentTemplateInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { RoutesService } from './routes.service';
import { isUniqueViolation } from '../../common/db/unique-violation';

/**
 * Versioned document templates (docs/modules/11 §12.7, plan §6.3).
 *
 * The template is the stable identity; every body is a version. A **published version is
 * immutable** — documents record the `template_version_id` they came from, so letting the
 * body move underneath them would silently rewrite what was already issued. Editing means
 * creating the next draft version and publishing that.
 *
 * Bodies go through the shared content allow-list on the way in (the DTO), and variables
 * are substituted from a fixed, server-built context — there is no expression evaluation
 * anywhere in this path.
 */
@Injectable()
export class DocumentTemplatesService {
  private readonly logger = new Logger(DocumentTemplatesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly routes: RoutesService,
  ) {}

  async list(actor: AuthUser): Promise<DocumentTemplateDto[]> {
    const rows = await this.db
      .select({
        id: documentTemplates.id,
        code: documentTemplates.code,
        name: documentTemplates.name,
        docClass: documentTemplates.docClass,
        documentTypeCode: documentTemplates.documentTypeCode,
        orgUnitId: documentTemplates.orgUnitId,
        orgUnitName: orgUnits.name,
        routeTemplateId: documentTemplates.routeTemplateId,
        isActive: documentTemplates.isActive,
      })
      .from(documentTemplates)
      .leftJoin(orgUnits, eq(orgUnits.id, documentTemplates.orgUnitId))
      .where(isNull(documentTemplates.deletedAt))
      .orderBy(asc(documentTemplates.name));
    return Promise.all(rows.map(async (r) => this.withVersions(r, actor)));
  }

  async detail(id: string, actor: AuthUser): Promise<DocumentTemplateDto> {
    const [row] = await this.db
      .select({
        id: documentTemplates.id,
        code: documentTemplates.code,
        name: documentTemplates.name,
        docClass: documentTemplates.docClass,
        documentTypeCode: documentTemplates.documentTypeCode,
        orgUnitId: documentTemplates.orgUnitId,
        orgUnitName: orgUnits.name,
        routeTemplateId: documentTemplates.routeTemplateId,
        isActive: documentTemplates.isActive,
      })
      .from(documentTemplates)
      .leftJoin(orgUnits, eq(orgUnits.id, documentTemplates.orgUnitId))
      .where(and(eq(documentTemplates.id, id), isNull(documentTemplates.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.template.not_found', 'Template not found');
    return this.withVersions(row, actor);
  }

  async create(input: CreateDocumentTemplateInput, actor: AuthUser): Promise<DocumentTemplateDto> {
    const [created] = await this.db
      .insert(documentTemplates)
      .values({
        code: input.code,
        name: input.name,
        docClass: input.docClass,
        documentTypeCode: input.documentTypeCode ?? null,
        orgUnitId: input.orgUnitId ?? null,
        routeTemplateId: input.routeTemplateId ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: documentTemplates.id })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw AppException.conflict(
            'docflow.template.code_taken',
            'A template with this code already exists',
          );
        }
        throw err;
      });
    if (!created) throw new Error('Template insert did not return an id');
    await this.audit.logAndWait({
      action: 'docflow.document_template.created',
      actorId: actor.id,
      entityType: 'document_template',
      entityId: created.id,
      meta: { code: input.code, docClass: input.docClass },
    });
    return this.detail(created.id, actor);
  }

  async update(
    id: string,
    input: UpdateDocumentTemplateInput,
    actor: AuthUser,
  ): Promise<DocumentTemplateDto> {
    await this.requireTemplate(id);
    await this.db
      .update(documentTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.docClass !== undefined ? { docClass: input.docClass } : {}),
        ...(input.documentTypeCode !== undefined
          ? { documentTypeCode: input.documentTypeCode ?? null }
          : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.routeTemplateId !== undefined
          ? { routeTemplateId: input.routeTemplateId ?? null }
          : {}),
        updatedBy: actor.id,
      })
      .where(eq(documentTemplates.id, id));
    await this.audit.logAndWait({
      action: 'docflow.document_template.updated',
      actorId: actor.id,
      entityType: 'document_template',
      entityId: id,
      meta: { changedFields: Object.keys(input) },
    });
    return this.detail(id, actor);
  }

  /** Retire a template: it disappears from the picker but its versions stay readable, so
   *  documents produced from it remain explainable. */
  async deactivate(id: string, actor: AuthUser): Promise<DocumentTemplateDto> {
    await this.requireTemplate(id);
    await this.db
      .update(documentTemplates)
      .set({ isActive: false, updatedBy: actor.id })
      .where(eq(documentTemplates.id, id));
    await this.audit.logAndWait({
      action: 'docflow.document_template.deactivated',
      actorId: actor.id,
      entityType: 'document_template',
      entityId: id,
    });
    return this.detail(id, actor);
  }

  /**
   * Add the next draft version. Never edits an existing one: a published body is frozen,
   * and even an unpublished draft gets a new number so the history of what was proposed
   * stays readable.
   */
  async addVersion(
    templateId: string,
    input: CreateTemplateVersionInput,
    actor: AuthUser,
  ): Promise<DocumentTemplateDto> {
    await this.requireTemplate(templateId);
    await this.db.transaction(async (tx) => {
      const [prior] = await tx
        .select({ max: sql<number>`coalesce(max(${documentTemplateVersions.version}), 0)::int` })
        .from(documentTemplateVersions)
        .where(eq(documentTemplateVersions.templateId, templateId));
      await tx.insert(documentTemplateVersions).values({
        templateId,
        version: (prior?.max ?? 0) + 1,
        contentJson: input.content,
        contentText: documentContentText(input.content),
        createdBy: actor.id,
      });
    });
    await this.audit.logAndWait({
      action: 'docflow.document_template.version_added',
      actorId: actor.id,
      entityType: 'document_template',
      entityId: templateId,
    });
    return this.detail(templateId, actor);
  }

  /** Publish a draft version. Publishing twice is a conflict, not a silent no-op — the
   *  second caller believed they were publishing something. */
  async publishVersion(
    templateId: string,
    version: number,
    actor: AuthUser,
  ): Promise<DocumentTemplateDto> {
    await this.requireTemplate(templateId);
    const now = new Date();
    const [published] = await this.db
      .update(documentTemplateVersions)
      .set({ publishedAt: now, publishedBy: actor.id })
      .where(
        and(
          eq(documentTemplateVersions.templateId, templateId),
          eq(documentTemplateVersions.version, version),
          isNull(documentTemplateVersions.publishedAt),
        ),
      )
      .returning({ id: documentTemplateVersions.id });
    if (!published) {
      throw AppException.conflict(
        'docflow.template.version_not_publishable',
        'That version does not exist or is already published',
        { version },
      );
    }
    await this.audit.logAndWait({
      action: 'docflow.document_template.version_published',
      actorId: actor.id,
      entityType: 'document_template',
      entityId: templateId,
      meta: { version },
    });
    return this.detail(templateId, actor);
  }

  /**
   * Create a draft document from a published template version. The document records which
   * version it came from, so the result stays reproducible after the template moves on.
   * Only a published version may be instantiated — a draft body is still being written.
   */
  async instantiate(
    templateId: string,
    input: InstantiateDocumentTemplateInput,
    actor: AuthUser,
  ): Promise<{ documentId: string }> {
    const template = await this.requireTemplate(templateId);
    if (!template.isActive) {
      throw AppException.unprocessable(
        'docflow.template.inactive',
        'This template has been retired',
      );
    }
    const [chosen] = await this.db
      .select()
      .from(documentTemplateVersions)
      .where(
        and(
          eq(documentTemplateVersions.templateId, templateId),
          sql`${documentTemplateVersions.publishedAt} is not null`,
          ...(input.version ? [eq(documentTemplateVersions.version, input.version)] : []),
        ),
      )
      .orderBy(desc(documentTemplateVersions.version))
      .limit(1);
    if (!chosen) {
      throw AppException.unprocessable(
        'docflow.template.no_published_version',
        'This template has no published version to instantiate',
      );
    }

    const context = await this.buildContext(actor, input);
    const source = (chosen.contentJson ?? { type: 'doc', content: [] }) as DocumentContent;
    const content = renderTemplateContent(source, context);

    const [created] = await this.db
      .insert(documents)
      .values({
        docClass: template.docClass,
        typeCode: template.documentTypeCode ?? 'letter',
        subject: input.subject,
        orgUnitId: input.orgUnitId ?? null,
        correspondentId: input.correspondentId ?? null,
        authorId: actor.id,
        createdBy: actor.id,
        contentJson: content,
        contentText: documentContentText(content),
        templateVersionId: chosen.id,
      })
      .returning({ id: documents.id });
    if (!created) throw new Error('Document insert did not return an id');
    await this.audit.logAndWait({
      action: 'docflow.document.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: created.id,
      meta: { templateId, version: chosen.version },
    });

    // The route a template names for its document type — «приказ идёт юрист → зам →
    // председатель» — was stored from the start and never read (plan этап 7 «templates +
    // routes по типу»). Started only when asked for: a draft the author still wants to
    // write in peace must not leave for approval the moment it is created.
    if (input.startRoute && template.routeTemplateId) {
      // Outside no transaction of ours: startRoute opens its own and locks the document.
      // A failure leaves a usable draft the author can route by hand, which is better than
      // a 500 that hides the document they just created.
      try {
        await this.routes.startRoute(created.id, { templateId: template.routeTemplateId }, actor);
      } catch (error) {
        this.logger.error(
          { error, documentId: created.id },
          'document instantiated but its template route did not start',
        );
      }
    }
    return { documentId: created.id };
  }

  /**
   * The render context — assembled field by field from named columns, never by spreading a
   * row. A wildcard would publish whatever column lands on `users` or `org_units` next.
   */
  private async buildContext(
    actor: AuthUser,
    input: InstantiateDocumentTemplateInput,
  ): Promise<TemplateContext> {
    const [author] = await this.db
      .select({ fullName: users.fullName, shortName: users.shortName })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    const [org] = input.orgUnitId
      ? await this.db
          .select({ name: orgUnits.name, shortName: orgUnits.shortName })
          .from(orgUnits)
          .where(eq(orgUnits.id, input.orgUnitId))
          .limit(1)
      : [];
    return {
      'document.subject': input.subject,
      'author.fullName': author?.fullName ?? null,
      'author.shortName': author?.shortName ?? null,
      'org.name': org?.name ?? null,
      'org.shortName': org?.shortName ?? null,
    };
  }

  private async requireTemplate(id: string): Promise<typeof documentTemplates.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documentTemplates)
      .where(and(eq(documentTemplates.id, id), isNull(documentTemplates.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.template.not_found', 'Template not found');
    return row;
  }

  private async withVersions(
    row: Omit<DocumentTemplateDto, 'versions' | 'publishedVersion'>,
    _actor: AuthUser,
  ): Promise<DocumentTemplateDto> {
    const publisher = users;
    const rows = await this.db
      .select({
        id: documentTemplateVersions.id,
        version: documentTemplateVersions.version,
        contentJson: documentTemplateVersions.contentJson,
        publishedAt: documentTemplateVersions.publishedAt,
        publishedByName: publisher.shortName,
        createdAt: documentTemplateVersions.createdAt,
      })
      .from(documentTemplateVersions)
      .leftJoin(publisher, eq(publisher.id, documentTemplateVersions.publishedBy))
      .where(eq(documentTemplateVersions.templateId, row.id))
      .orderBy(desc(documentTemplateVersions.version));
    const versions: DocumentTemplateVersionDto[] = rows.map((v) => ({
      id: v.id,
      version: v.version,
      content: (v.contentJson ?? null) as DocumentContent | null,
      isPublished: !!v.publishedAt,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      publishedByName: v.publishedByName ?? null,
      createdAt: v.createdAt.toISOString(),
      variables: collectTemplateVariables(v.contentJson),
    }));
    return {
      ...row,
      publishedVersion: versions.find((v) => v.isPublished)?.version ?? null,
      versions,
    };
  }
}
