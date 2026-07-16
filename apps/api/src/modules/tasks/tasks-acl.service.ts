import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  orgUnits,
  positions,
  taskProjectMembers,
  taskProjects,
  userPositions,
  type Database,
} from '@cuks/db';
import type { ProjectRole } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type ProjectRow = typeof taskProjects.$inferSelect;

/** owner > editor > viewer — a higher rank includes the lower ones' abilities. */
const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Project access control (docs/modules/15 §1, task 4.2). Visibility is the membership ACL
 * (task_project_members) plus an optional «виден подразделению» over the project's org unit
 * subtree; editing needs `editor`+, project/column/member management needs `owner`. Superadmin
 * bypasses.
 */
@Injectable()
export class TasksAclService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The caller's explicit membership role, or null. */
  async roleFor(projectId: string, userId: string): Promise<ProjectRole | null> {
    const [m] = await this.db
      .select({ role: taskProjectMembers.role })
      .from(taskProjectMembers)
      .where(
        and(eq(taskProjectMembers.projectId, projectId), eq(taskProjectMembers.userId, userId)),
      )
      .limit(1);
    return m?.role ?? null;
  }

  /** Whether the caller may VIEW the project (member / org-unit visibility / superadmin). */
  async canView(project: ProjectRow, actor: AuthUser): Promise<boolean> {
    if (actor.isSuperadmin) return true;
    if (await this.roleFor(project.id, actor.id)) return true;
    if (project.visibleToOrgUnit && project.orgUnitId) {
      return this.inOrgSubtree(actor.id, project.orgUnitId);
    }
    return false;
  }

  /** Load a project the caller may view, or 404. */
  async loadViewable(projectId: string, actor: AuthUser): Promise<ProjectRow> {
    const project = await this.load(projectId);
    if (!project || !(await this.canView(project, actor))) {
      throw AppException.notFound('tasks.project.not_found', 'Project not found');
    }
    return project;
  }

  /** Load a project the caller holds at least `min` role on (viewer/editor/owner), or 403/404. */
  async loadWithRole(projectId: string, actor: AuthUser, min: ProjectRole): Promise<ProjectRow> {
    const project = await this.loadViewable(projectId, actor);
    if (actor.isSuperadmin) return project;
    const role = await this.roleFor(projectId, actor.id);
    if (!role || RANK[role] < RANK[min]) {
      throw AppException.forbidden('tasks.project.forbidden', 'Insufficient project role');
    }
    return project;
  }

  private async load(projectId: string): Promise<ProjectRow | undefined> {
    const [row] = await this.db
      .select()
      .from(taskProjects)
      .where(and(eq(taskProjects.id, projectId), isNull(taskProjects.deletedAt)))
      .limit(1);
    return row;
  }

  /** Whether the user holds a position in the org unit or any of its descendants. */
  private async inOrgSubtree(userId: string, orgUnitId: string): Promise<boolean> {
    const [ou] = await this.db
      .select({ path: orgUnits.path })
      .from(orgUnits)
      .where(eq(orgUnits.id, orgUnitId))
      .limit(1);
    if (!ou) return false;
    const [hit] = await this.db
      .select({ id: positions.id })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(
        and(
          eq(userPositions.userId, userId),
          or(eq(orgUnits.id, orgUnitId), sql`${orgUnits.path} like ${`${ou.path}.%`}`),
        ),
      )
      .limit(1);
    return !!hit;
  }
}
