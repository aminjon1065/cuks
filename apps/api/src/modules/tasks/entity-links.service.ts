import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  documents,
  entityLinks,
  incidents,
  taskActivity,
  taskProjectMembers,
  taskProjects,
  tasks,
  type Database,
} from '@cuks/db';
import {
  wsRooms,
  type CreateEntityLinkInput,
  type CreateLinkedCardInput,
  type EntityLinkDto,
  type LinkedTaskDto,
  type TaskCardDto,
  type TaskLinkTarget,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { TasksAclService } from './tasks-acl.service';
import { TasksService } from './tasks.service';

/**
 * Task ↔ ЧС/document links (docs/modules/15 §2/§6, task 4.5). A card can be linked to an incident
 * or a document; the link shows on both sides. Link rows carry only the ЧС number / document
 * reg-number (never a ДСП subject); opening the target still enforces that module's own ACL.
 */
@Injectable()
export class EntityLinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly tasks: TasksService,
  ) {}

  async listLinks(taskId: string, actor: AuthUser): Promise<EntityLinkDto[]> {
    await this.acl.loadCardWithRole(taskId, actor, 'viewer');
    return this.resolve(taskId);
  }

  async addLink(
    taskId: string,
    input: CreateEntityLinkInput,
    actor: AuthUser,
  ): Promise<EntityLinkDto[]> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'editor');
    await this.requireTarget(input.targetType, input.targetId);
    await this.insertLink(taskId, input, actor.id);
    this.emit(card.projectId, taskId, actor.id);
    return this.resolve(taskId);
  }

  async removeLink(taskId: string, linkId: string, actor: AuthUser): Promise<EntityLinkDto[]> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'editor');
    const [row] = await this.db
      .delete(entityLinks)
      .where(
        and(
          eq(entityLinks.id, linkId),
          eq(entityLinks.sourceType, 'task'),
          eq(entityLinks.sourceId, taskId),
        ),
      )
      .returning({ id: entityLinks.id });
    if (!row) throw AppException.notFound('tasks.link.not_found', 'Link not found');
    this.audit.log({
      action: 'tasks.card.unlinked',
      actorId: actor.id,
      entityType: 'task',
      entityId: taskId,
    });
    this.emit(card.projectId, taskId, actor.id);
    return this.resolve(taskId);
  }

  /** Create a card in a project and link it to a ЧС/document in one step (docs/modules/15 §6). */
  async createLinkedCard(input: CreateLinkedCardInput, actor: AuthUser): Promise<TaskCardDto> {
    await this.requireTarget(input.targetType, input.targetId);
    const card = await this.tasks.createCard(
      input.projectId,
      {
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        assigneeIds: input.assigneeIds,
        priority: 'p3',
        dueAt: input.dueAt,
        startAt: null,
        labels: [],
      },
      actor,
    );
    await this.insertLink(
      card.id,
      { targetType: input.targetType, targetId: input.targetId },
      actor.id,
    );
    this.emit(input.projectId, card.id, actor.id);
    return card;
  }

  /** Tasks linked to an entity, scoped to the caller's projects («связь видна с обеих сторон»). */
  async linkedTasks(
    targetType: TaskLinkTarget,
    targetId: string,
    actor: AuthUser,
  ): Promise<LinkedTaskDto[]> {
    const rows = await this.db
      .select({
        id: tasks.id,
        projectKey: taskProjects.key,
        seq: tasks.seq,
        title: tasks.title,
        priority: tasks.priority,
        completedAt: tasks.completedAt,
      })
      .from(entityLinks)
      .innerJoin(tasks, and(eq(tasks.id, entityLinks.sourceId), isNull(tasks.deletedAt)))
      .innerJoin(taskProjects, eq(taskProjects.id, tasks.projectId))
      .innerJoin(
        taskProjectMembers,
        and(
          eq(taskProjectMembers.projectId, tasks.projectId),
          eq(taskProjectMembers.userId, actor.id),
        ),
      )
      .where(
        and(
          eq(entityLinks.sourceType, 'task'),
          eq(entityLinks.targetType, targetType),
          eq(entityLinks.targetId, targetId),
          isNull(tasks.archivedAt),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      projectKey: r.projectKey,
      seq: r.seq,
      title: r.title,
      priority: r.priority,
      completedAt: r.completedAt?.toISOString() ?? null,
      route: `/app/tasks/projects/${r.projectKey}/${r.seq}`,
    }));
  }

  private async insertLink(
    taskId: string,
    input: CreateEntityLinkInput,
    actorId: string,
  ): Promise<void> {
    await this.db
      .insert(entityLinks)
      .values({
        sourceType: 'task',
        sourceId: taskId,
        targetType: input.targetType,
        targetId: input.targetId,
        createdBy: actorId,
      })
      .onConflictDoNothing({
        target: [
          entityLinks.sourceType,
          entityLinks.sourceId,
          entityLinks.targetType,
          entityLinks.targetId,
        ],
      });
    await this.db.insert(taskActivity).values({
      taskId,
      actorId,
      action: 'tasks.card.linked',
      meta: { targetType: input.targetType, targetId: input.targetId },
    });
    this.audit.log({
      action: 'tasks.card.linked',
      actorId,
      entityType: 'task',
      entityId: taskId,
      meta: { targetType: input.targetType, targetId: input.targetId },
    });
  }

  /** Verify the link target exists (and is not deleted) so links can't point at nothing. */
  private async requireTarget(targetType: TaskLinkTarget, targetId: string): Promise<void> {
    if (targetType === 'incident') {
      const [row] = await this.db
        .select({ id: incidents.id })
        .from(incidents)
        .where(and(eq(incidents.id, targetId), isNull(incidents.deletedAt)))
        .limit(1);
      if (!row) throw AppException.notFound('tasks.link.target_not_found', 'Incident not found');
    } else {
      const [row] = await this.db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, targetId), isNull(documents.deletedAt)))
        .limit(1);
      if (!row) throw AppException.notFound('tasks.link.target_not_found', 'Document not found');
    }
  }

  /** Resolve a card's links to display rows (title = ЧС number / doc reg-number; deleted targets
   *  are dropped). */
  private async resolve(taskId: string): Promise<EntityLinkDto[]> {
    const links = await this.db
      .select()
      .from(entityLinks)
      .where(and(eq(entityLinks.sourceType, 'task'), eq(entityLinks.sourceId, taskId)));
    if (links.length === 0) return [];

    const incidentIds = links.filter((l) => l.targetType === 'incident').map((l) => l.targetId);
    const documentIds = links.filter((l) => l.targetType === 'document').map((l) => l.targetId);
    const [incRows, docRows] = await Promise.all([
      incidentIds.length
        ? this.db
            .select({ id: incidents.id, number: incidents.number })
            .from(incidents)
            .where(and(inArray(incidents.id, incidentIds), isNull(incidents.deletedAt)))
        : Promise.resolve([] as { id: string; number: string }[]),
      documentIds.length
        ? this.db
            .select({ id: documents.id, regNumber: documents.regNumber })
            .from(documents)
            .where(and(inArray(documents.id, documentIds), isNull(documents.deletedAt)))
        : Promise.resolve([] as { id: string; regNumber: string | null }[]),
    ]);
    const incMap = new Map(incRows.map((r) => [r.id, r.number]));
    const docMap = new Map(docRows.map((r) => [r.id, r.regNumber]));

    const out: EntityLinkDto[] = [];
    for (const l of links) {
      if (l.targetType === 'incident') {
        const number = incMap.get(l.targetId);
        if (!number) continue;
        out.push({
          id: l.id,
          targetType: 'incident',
          targetId: l.targetId,
          title: `ЧС ${number}`,
          subtitle: null,
          route: `/app/incidents/${l.targetId}`,
        });
      } else if (l.targetType === 'document') {
        if (!docMap.has(l.targetId)) continue;
        out.push({
          id: l.id,
          targetType: 'document',
          targetId: l.targetId,
          title: docMap.get(l.targetId) ?? 'Документ',
          subtitle: null,
          route: `/app/docs/${l.targetId}`,
        });
      }
    }
    return out;
  }

  private emit(projectId: string, taskId: string, actorId: string): void {
    this.realtime.emitToRoom(wsRooms.board(projectId), 'tasks.card.updated', {
      projectId,
      taskId,
      actorId,
    });
  }
}
