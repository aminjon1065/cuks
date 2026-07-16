import { z } from 'zod';
import { PROJECT_ROLES, TASK_PRIORITIES, type ProjectRole, type TaskPriority } from '../enums';

// --- Projects (docs/modules/15 §1/§2, task 4.2) ---

/** A short uppercase code that prefixes card numbers (`ОПЕР-142`). */
const projectKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-ZА-Я0-9]+$/u, 'letters and digits only');

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: projectKeySchema,
  description: z.string().max(2000).nullish(),
  orgUnitId: z.string().uuid().nullish(),
  visibleToOrgUnit: z.boolean().default(false),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().omit({ key: true });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  key: string;
  description: string | null;
  orgUnitId: string | null;
  visibleToOrgUnit: boolean;
  isArchived: boolean;
  /** The caller's role in the project (null when they see it only via org-unit visibility). */
  myRole: ProjectRole | null;
  createdAt: string;
}

export interface ProjectMemberDto {
  userId: string;
  name: string | null;
  role: ProjectRole;
}

/** Set a member's role, or remove them (role omitted → delete). */
export const setProjectMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(PROJECT_ROLES),
});
export type SetProjectMemberInput = z.infer<typeof setProjectMemberSchema>;

// --- Columns (docs/modules/15 §3) ---

export const createColumnSchema = z.object({
  name: z.string().trim().min(1).max(60),
  wipLimit: z.number().int().min(1).max(999).nullish(),
  isDoneColumn: z.boolean().default(false),
});
export type CreateColumnInput = z.infer<typeof createColumnSchema>;

export const updateColumnSchema = createColumnSchema.partial();
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

/** Move a column after another (null = to the front). */
export const moveColumnSchema = z.object({ afterColumnId: z.string().uuid().nullable() });
export type MoveColumnInput = z.infer<typeof moveColumnSchema>;

export interface ColumnDto {
  id: string;
  name: string;
  orderKey: string;
  wipLimit: number | null;
  isDoneColumn: boolean;
}

// --- Labels (docs/modules/15 §2) ---

export interface LabelDto {
  id: string;
  name: string;
  color: string;
}

// --- Cards (docs/modules/15 §2/§3) ---

export const createTaskSchema = z.object({
  columnId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  description: z.unknown().nullish(),
  assigneeIds: z.array(z.string().uuid()).max(20).default([]),
  priority: z.enum(TASK_PRIORITIES).default('p3'),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  startAt: z.string().datetime({ offset: true }).nullish(),
  labels: z.array(z.string().uuid()).max(50).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.unknown().nullish(),
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
  watcherIds: z.array(z.string().uuid()).max(50).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  startAt: z.string().datetime({ offset: true }).nullish(),
  labels: z.array(z.string().uuid()).max(50).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Move a card into a column, after another card (null = to the top of the column). */
export const moveTaskSchema = z.object({
  columnId: z.string().uuid(),
  afterTaskId: z.string().uuid().nullable(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

/** A card as rendered on the board (docs/modules/15 §3) — compact, one flat list per board. */
export interface TaskCardDto {
  id: string;
  seq: number;
  columnId: string;
  orderKey: string;
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
  assigneeIds: string[];
  labels: string[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  completedAt: string | null;
  archivedAt: string | null;
}

/** A person who can be assigned / mentioned on this board (project members). */
export interface BoardMemberDto {
  userId: string;
  name: string | null;
}

/** The whole board in one request (docs/modules/15 §8): project, columns, labels, cards, members. */
export interface BoardDto {
  project: ProjectDto;
  columns: ColumnDto[];
  labels: LabelDto[];
  members: BoardMemberDto[];
  cards: TaskCardDto[];
}
