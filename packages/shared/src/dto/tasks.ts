import { z } from 'zod';
import {
  PROJECT_ROLES,
  TASK_DEADLINE_TIERS,
  TASK_LABEL_COLORS,
  TASK_LINK_TARGETS,
  TASK_PRIORITIES,
  type ProjectRole,
  type TaskLinkTarget,
  type TaskPriority,
} from '../enums';

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

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(TASK_LABEL_COLORS),
});
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

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

// --- Card detail / SidePanel (docs/modules/15 §4, task 4.3) ---

/** A checklist item on a card. `orderKey` is a fractional index (drag rewrites only its row). */
export interface ChecklistItemDto {
  id: string;
  text: string;
  isDone: boolean;
  orderKey: string;
}

export const createChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
});
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;

/** Edit a checklist item: rename, toggle, and/or reorder after another item (null = to the top). */
export const updateChecklistItemSchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    isDone: z.boolean().optional(),
    afterItemId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.text !== undefined || v.isDone !== undefined || v.afterItemId !== undefined, {
    message: 'nothing to update',
  });
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

/** The full card behind the SidePanel — every editable field plus the checklist. */
export interface TaskCardDetailDto extends TaskCardDto {
  projectId: string;
  description: unknown;
  descriptionText: string | null;
  watcherIds: string[];
  authorId: string;
  startAt: string | null;
  createdAt: string;
  updatedAt: string;
  checklist: ChecklistItemDto[];
}

// --- Comments (docs/modules/15 §4) ---

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentionIds: z.array(z.string().uuid()).max(50).default([]),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export interface CommentDto {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Activity / «История» (docs/modules/15 §2/§9) ---

export interface ActivityDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

// --- «Мои задачи» (docs/modules/15 §5, task 4.4) ---

/** Filter the personal queue to tasks assigned to me (default) or ones I only watch. */
export const myTasksQuerySchema = z.object({
  watching: z
    .preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean())
    .optional()
    .default(false),
});
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;

/** One row of the personal queue across all projects — enough to render and deep-link a card. */
export interface MyTaskDto {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  seq: number;
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
}

// --- Deadline notifications (docs/modules/15 §7) ---

/** notification_outbox topic for task deadline reminders (task 4.4). The worker inserts rows under
 *  this topic during its daily sweep; a tasks API dispatcher fans them out. */
export const TASKS_DEADLINE_TOPIC = 'tasks.deadline';

export const tasksDeadlinePayloadSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectKey: z.string(),
  seq: z.number().int(),
  title: z.string(),
  tier: z.enum(TASK_DEADLINE_TIERS),
  recipientUserIds: z.array(z.string().uuid()).min(1),
});
export type TasksDeadlinePayload = z.infer<typeof tasksDeadlinePayloadSchema>;

// --- Links to other modules (docs/modules/15 §4/§6, task 4.5) ---

/** Link a card to a ЧС or a document. */
export const createEntityLinkSchema = z.object({
  targetType: z.enum(TASK_LINK_TARGETS),
  targetId: z.string().uuid(),
});
export type CreateEntityLinkInput = z.infer<typeof createEntityLinkSchema>;

/** A card's link to another entity, resolved for display (title = ЧС number / document reg-number —
 *  never a ДСП subject) with the SPA route to open it. */
export interface EntityLinkDto {
  id: string;
  targetType: TaskLinkTarget;
  targetId: string;
  title: string;
  subtitle: string | null;
  route: string;
}

/** A task linked to a given entity — shown on the ЧС / document card («связь видна с обеих сторон»). */
export interface LinkedTaskDto {
  id: string;
  projectKey: string;
  seq: number;
  title: string;
  priority: TaskPriority;
  completedAt: string | null;
  route: string;
}

/** Create a card in a project and link it to a ЧС/document in one step (docs/modules/15 §6). */
export const createLinkedCardSchema = z.object({
  projectId: z.string().uuid(),
  columnId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  description: z.unknown().nullish(),
  assigneeIds: z.array(z.string().uuid()).max(20).default([]),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  targetType: z.enum(TASK_LINK_TARGETS),
  targetId: z.string().uuid(),
});
export type CreateLinkedCardInput = z.infer<typeof createLinkedCardSchema>;

// --- Card templates (docs/modules/15 §4) ---

export const createTaskTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(500),
  description: z.unknown().nullish(),
  priority: z.enum(TASK_PRIORITIES).default('p3'),
  checklist: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});
export type CreateTaskTemplateInput = z.infer<typeof createTaskTemplateSchema>;

/** Instantiate a template into a column. */
export const instantiateTemplateSchema = z.object({ columnId: z.string().uuid() });
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;

export interface TaskTemplateDto {
  id: string;
  name: string;
  title: string;
  description: unknown;
  descriptionText: string | null;
  priority: TaskPriority;
  checklist: string[];
}

/** The whole board in one request (docs/modules/15 §8): project, columns, labels, cards, members. */
export interface BoardDto {
  project: ProjectDto;
  columns: ColumnDto[];
  labels: LabelDto[];
  members: BoardMemberDto[];
  cards: TaskCardDto[];
}
