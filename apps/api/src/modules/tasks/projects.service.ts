import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, isNull } from 'drizzle-orm';
import { taskColumns, taskProjectMembers, taskProjects, users, type Database } from '@cuks/db';
import {
  keysBetween,
  type CreateProjectInput,
  type ProjectDto,
  type ProjectMemberDto,
  type ProjectRole,
  type SetProjectMemberInput,
  type UpdateProjectInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { TasksAclService } from './tasks-acl.service';

type ProjectRow = typeof taskProjects.$inferSelect;

/** The three default columns a new project starts with (docs/modules/15 §3). */
const DEFAULT_COLUMNS = ['К выполнению', 'В работе', 'Готово'] as const;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly audit: AuditService,
  ) {}

  /** Create a project with the caller as owner and three default columns. */
  async create(input: CreateProjectInput, actor: AuthUser): Promise<ProjectDto> {
    const key = input.key.toUpperCase();
    const [dup] = await this.db
      .select({ id: taskProjects.id })
      .from(taskProjects)
      .where(and(eq(taskProjects.key, key), isNull(taskProjects.deletedAt)))
      .limit(1);
    if (dup) throw AppException.conflict('tasks.project.key_taken', 'Project key already in use');

    const project = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(taskProjects)
        .values({
          name: input.name,
          key,
          description: input.description ?? null,
          orgUnitId: input.orgUnitId ?? null,
          visibleToOrgUnit: input.visibleToOrgUnit,
          createdBy: actor.id,
        })
        .returning();
      await tx
        .insert(taskProjectMembers)
        .values({ projectId: p!.id, userId: actor.id, role: 'owner' });
      const orderKeys = keysBetween(null, null, DEFAULT_COLUMNS.length);
      await tx.insert(taskColumns).values(
        DEFAULT_COLUMNS.map((name, i) => ({
          projectId: p!.id,
          name,
          orderKey: orderKeys[i]!,
          isDoneColumn: i === DEFAULT_COLUMNS.length - 1,
        })),
      );
      return p!;
    });
    this.audit.log({
      action: 'tasks.project.created',
      actorId: actor.id,
      entityType: 'task_project',
      entityId: project.id,
      meta: { key },
    });
    return this.toDto(project, 'owner');
  }

  /** Projects the caller is a member of (with their role), newest first. */
  async list(actor: AuthUser): Promise<ProjectDto[]> {
    const rows = await this.db
      .select({ project: taskProjects, role: taskProjectMembers.role })
      .from(taskProjectMembers)
      .innerJoin(taskProjects, eq(taskProjects.id, taskProjectMembers.projectId))
      .where(and(eq(taskProjectMembers.userId, actor.id), isNull(taskProjects.deletedAt)))
      .orderBy(desc(taskProjects.createdAt));
    return rows.map((r) => this.toDto(r.project, r.role));
  }

  async getById(id: string, actor: AuthUser): Promise<ProjectDto> {
    const project = await this.acl.loadViewable(id, actor);
    return this.toDto(project, await this.acl.roleFor(id, actor.id));
  }

  async getByKey(key: string, actor: AuthUser): Promise<ProjectDto> {
    const [project] = await this.db
      .select()
      .from(taskProjects)
      .where(and(eq(taskProjects.key, key.toUpperCase()), isNull(taskProjects.deletedAt)))
      .limit(1);
    if (!project || !(await this.acl.canView(project, actor))) {
      throw AppException.notFound('tasks.project.not_found', 'Project not found');
    }
    return this.toDto(project, await this.acl.roleFor(project.id, actor.id));
  }

  async update(id: string, input: UpdateProjectInput, actor: AuthUser): Promise<ProjectDto> {
    await this.acl.loadWithRole(id, actor, 'owner');
    await this.db
      .update(taskProjects)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.visibleToOrgUnit !== undefined
          ? { visibleToOrgUnit: input.visibleToOrgUnit }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(taskProjects.id, id));
    return this.getById(id, actor);
  }

  async archive(id: string, actor: AuthUser): Promise<ProjectDto> {
    await this.acl.loadWithRole(id, actor, 'owner');
    await this.db
      .update(taskProjects)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(taskProjects.id, id));
    return this.getById(id, actor);
  }

  // --- Members ---

  async members(id: string, actor: AuthUser): Promise<ProjectMemberDto[]> {
    await this.acl.loadViewable(id, actor);
    const member = aliasedTable(users, 'tp_member');
    const rows = await this.db
      .select({
        userId: taskProjectMembers.userId,
        name: member.shortName,
        role: taskProjectMembers.role,
      })
      .from(taskProjectMembers)
      .leftJoin(member, eq(member.id, taskProjectMembers.userId))
      .where(eq(taskProjectMembers.projectId, id));
    return rows.map((r) => ({ userId: r.userId, name: r.name ?? null, role: r.role }));
  }

  async setMember(
    id: string,
    input: SetProjectMemberInput,
    actor: AuthUser,
  ): Promise<ProjectMemberDto[]> {
    await this.acl.loadWithRole(id, actor, 'owner');
    // Keep at least one owner: demoting the sole owner (incl. self) would orphan the project.
    if (input.role !== 'owner') {
      const owners = await this.db
        .select({ userId: taskProjectMembers.userId })
        .from(taskProjectMembers)
        .where(and(eq(taskProjectMembers.projectId, id), eq(taskProjectMembers.role, 'owner')));
      if (owners.length === 1 && owners[0]!.userId === input.userId) {
        throw AppException.badRequest('tasks.project.last_owner', 'A project must keep an owner');
      }
    }
    await this.db
      .insert(taskProjectMembers)
      .values({ projectId: id, userId: input.userId, role: input.role })
      .onConflictDoUpdate({
        target: [taskProjectMembers.projectId, taskProjectMembers.userId],
        set: { role: input.role },
      });
    return this.members(id, actor);
  }

  async removeMember(id: string, userId: string, actor: AuthUser): Promise<ProjectMemberDto[]> {
    await this.acl.loadWithRole(id, actor, 'owner');
    // Keep at least one owner.
    const owners = await this.db
      .select({ userId: taskProjectMembers.userId })
      .from(taskProjectMembers)
      .where(and(eq(taskProjectMembers.projectId, id), eq(taskProjectMembers.role, 'owner')));
    if (owners.length === 1 && owners[0]!.userId === userId) {
      throw AppException.badRequest('tasks.project.last_owner', 'A project must keep an owner');
    }
    await this.db
      .delete(taskProjectMembers)
      .where(and(eq(taskProjectMembers.projectId, id), eq(taskProjectMembers.userId, userId)));
    return this.members(id, actor);
  }

  /** Resolve project member ids to names (for the board's assignee pickers). */
  async memberDirectory(projectId: string): Promise<{ userId: string; name: string | null }[]> {
    const member = aliasedTable(users, 'tp_dir');
    const rows = await this.db
      .select({ userId: taskProjectMembers.userId, name: member.shortName })
      .from(taskProjectMembers)
      .leftJoin(member, eq(member.id, taskProjectMembers.userId))
      .where(eq(taskProjectMembers.projectId, projectId));
    return rows.map((r) => ({ userId: r.userId, name: r.name ?? null }));
  }

  private toDto(project: ProjectRow, myRole: ProjectRole | null): ProjectDto {
    return {
      id: project.id,
      name: project.name,
      key: project.key,
      description: project.description,
      orgUnitId: project.orgUnitId,
      visibleToOrgUnit: project.visibleToOrgUnit,
      isArchived: project.isArchived,
      myRole,
      createdAt: project.createdAt.toISOString(),
    };
  }
}
