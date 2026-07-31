import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, isNull } from 'drizzle-orm';
import { documentCollaborators, users, type Database } from '@cuks/db';
import type { AddDocumentCollaboratorInput, DocumentCollaboratorDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { collaboratorRolesOf } from './document-actions';
import { DocumentsService } from './documents.service';

/**
 * Who besides the author works on a document (docs/modules/11 §12.5, plan §6.2). Managing
 * the list is the author's (or a superadmin's) right — a preparer cannot invite further
 * preparers, and no collaborator role widens ДСП access, which stays the allow-list's job.
 * Grants are soft-deleted so a revoked one remains visible in the history.
 */
@Injectable()
export class DocumentCollaboratorsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  /** Visible to anyone who can see the document — knowing who prepares it is part of the card. */
  async list(documentId: string, actor: AuthUser): Promise<DocumentCollaboratorDto[]> {
    await this.documents.assertVisible(documentId, actor);
    return this.listFor(documentId);
  }

  async add(
    documentId: string,
    input: AddDocumentCollaboratorInput,
    actor: AuthUser,
  ): Promise<DocumentCollaboratorDto[]> {
    const doc = await this.requireManageable(documentId, actor);
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.status, 'active'), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw AppException.badRequest(
        'docflow.collaborator.user_not_found',
        'That user cannot be added as a collaborator',
      );
    }
    if (input.userId === doc.authorId) {
      throw AppException.unprocessable(
        'docflow.collaborator.author_redundant',
        'The author already owns the document',
      );
    }
    // Re-granting a role the user already holds is a no-op, not a duplicate row — the
    // partial unique index backstops a concurrent double submit.
    const existing = await collaboratorRolesOf(this.db, documentId, input.userId);
    if (!existing.includes(input.role)) {
      await this.db.insert(documentCollaborators).values({
        documentId,
        userId: input.userId,
        role: input.role,
        assignedBy: actor.id,
      });
      await this.audit.logAndWait({
        action: 'docflow.document.collaborator_added',
        actorId: actor.id,
        entityType: 'document',
        entityId: documentId,
        meta: { userId: input.userId, role: input.role },
      });
    }
    return this.listFor(documentId);
  }

  async remove(
    documentId: string,
    collaboratorId: string,
    actor: AuthUser,
  ): Promise<DocumentCollaboratorDto[]> {
    await this.requireManageable(documentId, actor);
    const [removed] = await this.db
      .update(documentCollaborators)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(documentCollaborators.id, collaboratorId),
          eq(documentCollaborators.documentId, documentId),
          isNull(documentCollaborators.deletedAt),
        ),
      )
      .returning({ userId: documentCollaborators.userId, role: documentCollaborators.role });
    if (!removed) {
      throw AppException.notFound('docflow.collaborator.not_found', 'Collaborator not found');
    }
    await this.audit.logAndWait({
      action: 'docflow.document.collaborator_removed',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { userId: removed.userId, role: removed.role },
    });
    return this.listFor(documentId);
  }

  /** The author or a superadmin only — mirrors the `manageCollaborators` available action. */
  private async requireManageable(
    documentId: string,
    actor: AuthUser,
  ): Promise<{ authorId: string }> {
    const doc = await this.documents.assertVisible(documentId, actor);
    if (doc.authorId !== actor.id && !actor.isSuperadmin) {
      throw AppException.forbidden(
        'docflow.collaborator.forbidden',
        'Only the author may manage collaborators',
      );
    }
    return doc;
  }

  private async listFor(documentId: string): Promise<DocumentCollaboratorDto[]> {
    const assigner = aliasedTable(users, 'collaborator_assigner');
    const rows = await this.db
      .select({
        id: documentCollaborators.id,
        userId: documentCollaborators.userId,
        userName: users.shortName,
        role: documentCollaborators.role,
        assignedByName: assigner.shortName,
        createdAt: documentCollaborators.createdAt,
      })
      .from(documentCollaborators)
      .leftJoin(users, eq(users.id, documentCollaborators.userId))
      .leftJoin(assigner, eq(assigner.id, documentCollaborators.assignedBy))
      .where(
        and(
          eq(documentCollaborators.documentId, documentId),
          isNull(documentCollaborators.deletedAt),
        ),
      )
      .orderBy(asc(documentCollaborators.createdAt));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName ?? null,
      role: r.role,
      assignedByName: r.assignedByName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
