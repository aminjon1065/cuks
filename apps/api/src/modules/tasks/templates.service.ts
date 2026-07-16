import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { taskChecklistItems, taskTemplates, type Database } from '@cuks/db';
import {
  keysBetween,
  tiptapPlainText,
  type CreateTaskTemplateInput,
  type InstantiateTemplateInput,
  type TaskCardDto,
  type TaskTemplateDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { TasksAclService } from './tasks-acl.service';
import { TasksService } from './tasks.service';

type TemplateRow = typeof taskTemplates.$inferSelect;

/** Project card templates (docs/modules/15 §4, task 4.5): named presets of title / description /
 *  priority / checklist. Viewing needs `viewer`; managing and instantiating need `editor`. */
@Injectable()
export class TaskTemplatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
  ) {}

  async list(projectId: string, actor: AuthUser): Promise<TaskTemplateDto[]> {
    await this.acl.loadViewable(projectId, actor);
    const rows = await this.db
      .select()
      .from(taskTemplates)
      .where(and(eq(taskTemplates.projectId, projectId), isNull(taskTemplates.deletedAt)))
      .orderBy(asc(taskTemplates.createdAt));
    return rows.map((r) => this.toDto(r));
  }

  async create(
    projectId: string,
    input: CreateTaskTemplateInput,
    actor: AuthUser,
  ): Promise<TaskTemplateDto> {
    await this.acl.loadWithRole(projectId, actor, 'editor');
    const description = input.description ?? null;
    const [row] = await this.db
      .insert(taskTemplates)
      .values({
        projectId,
        name: input.name,
        title: input.title,
        description,
        descriptionText: description ? tiptapPlainText(description) : null,
        priority: input.priority,
        checklist: input.checklist,
        createdBy: actor.id,
      })
      .returning();
    this.audit.log({
      action: 'tasks.template.created',
      actorId: actor.id,
      entityType: 'task_project',
      entityId: projectId,
      meta: { templateId: row!.id },
    });
    return this.toDto(row!);
  }

  async remove(projectId: string, templateId: string, actor: AuthUser): Promise<void> {
    await this.acl.loadWithRole(projectId, actor, 'editor');
    const [row] = await this.db
      .update(taskTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(taskTemplates.id, templateId),
          eq(taskTemplates.projectId, projectId),
          isNull(taskTemplates.deletedAt),
        ),
      )
      .returning({ id: taskTemplates.id });
    if (!row) throw AppException.notFound('tasks.template.not_found', 'Template not found');
  }

  /** Instantiate a template into a column: a card seeded with its title/description/priority plus
   *  its checklist items. */
  async instantiate(
    projectId: string,
    templateId: string,
    input: InstantiateTemplateInput,
    actor: AuthUser,
  ): Promise<TaskCardDto> {
    await this.acl.loadWithRole(projectId, actor, 'editor');
    const [tpl] = await this.db
      .select()
      .from(taskTemplates)
      .where(
        and(
          eq(taskTemplates.id, templateId),
          eq(taskTemplates.projectId, projectId),
          isNull(taskTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!tpl) throw AppException.notFound('tasks.template.not_found', 'Template not found');

    const card = await this.tasks.createCard(
      projectId,
      {
        columnId: input.columnId,
        title: tpl.title,
        description: tpl.description,
        assigneeIds: [],
        priority: tpl.priority,
        dueAt: null,
        startAt: null,
        labels: [],
      },
      actor,
    );
    if (tpl.checklist.length) {
      const keys = keysBetween(null, null, tpl.checklist.length);
      await this.db
        .insert(taskChecklistItems)
        .values(tpl.checklist.map((text, i) => ({ taskId: card.id, text, orderKey: keys[i]! })));
    }
    return card;
  }

  private toDto(r: TemplateRow): TaskTemplateDto {
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      description: r.description ?? null,
      descriptionText: r.descriptionText,
      priority: r.priority,
      checklist: r.checklist,
    };
  }
}
