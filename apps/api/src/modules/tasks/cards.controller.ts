import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createChecklistItemSchema,
  createCommentSchema,
  createEntityLinkSchema,
  moveTaskSchema,
  updateChecklistItemSchema,
  updateTaskSchema,
  type ActivityDto,
  type ChecklistItemDto,
  type CommentDto,
  type CreateChecklistItemInput,
  type CreateCommentInput,
  type CreateEntityLinkInput,
  type EntityLinkDto,
  type MoveTaskInput,
  type TaskCardDetailDto,
  type TaskCardDto,
  type UpdateChecklistItemInput,
  type UpdateTaskInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { TasksService } from './tasks.service';
import { ChecklistService } from './checklist.service';
import { TaskCommentsService } from './comments.service';
import { EntityLinksService } from './entity-links.service';

const uuidSchema = z.string().uuid();
const uuidPipe = new ZodValidationPipe(uuidSchema);

/** Card-scoped operations (docs/modules/15 §3/§4) — detail, edit, move, checklist, comments,
 *  activity, watch, complete, copy and archive. All gated by `tasks.use`; finer role checks (viewer
 *  to read/comment/watch, editor to mutate) live in the services. */
@ApiTags('tasks')
@RequirePermission('tasks.use')
@Controller('tasks/cards')
export class CardsController {
  constructor(
    private readonly tasks: TasksService,
    private readonly checklist: ChecklistService,
    private readonly comments: TaskCommentsService,
    private readonly links: EntityLinksService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Full card for the SidePanel (viewer)' })
  detail(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDetailDto> {
    return this.tasks.cardDetail(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a card (editor)' })
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.tasks.updateCard(id, body, user);
  }

  @Post(':id/move')
  @ApiOperation({ summary: 'Move a card into a column at a position (editor)' })
  move(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(moveTaskSchema)) body: MoveTaskInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.tasks.moveCard(id, body, user);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Move the card into the done column (editor)' })
  complete(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TaskCardDto> {
    return this.tasks.completeCard(id, user);
  }

  @Post(':id/copy')
  @ApiOperation({ summary: 'Duplicate a card (editor)' })
  copy(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TaskCardDto> {
    return this.tasks.copyCard(id, user);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a card (editor)' })
  archive(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.tasks.archiveCard(id, user);
  }

  @Post(':id/watch')
  @ApiOperation({ summary: 'Subscribe as a watcher (viewer)' })
  watch(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDetailDto> {
    return this.tasks.setWatching(id, true, user);
  }

  @Delete(':id/watch')
  @ApiOperation({ summary: 'Unsubscribe as a watcher (viewer)' })
  unwatch(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDetailDto> {
    return this.tasks.setWatching(id, false, user);
  }

  // --- Checklist ---

  @Post(':id/checklist')
  @ApiOperation({ summary: 'Add a checklist item (editor)' })
  addChecklistItem(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createChecklistItemSchema)) body: CreateChecklistItemInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChecklistItemDto[]> {
    return this.checklist.add(id, body, user);
  }

  @Patch(':id/checklist/:itemId')
  @ApiOperation({ summary: 'Rename / toggle / reorder a checklist item (editor)' })
  updateChecklistItem(
    @Param('id', uuidPipe) id: string,
    @Param('itemId', uuidPipe) itemId: string,
    @Body(new ZodValidationPipe(updateChecklistItemSchema)) body: UpdateChecklistItemInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChecklistItemDto[]> {
    return this.checklist.update(id, itemId, body, user);
  }

  @Delete(':id/checklist/:itemId')
  @ApiOperation({ summary: 'Delete a checklist item (editor)' })
  removeChecklistItem(
    @Param('id', uuidPipe) id: string,
    @Param('itemId', uuidPipe) itemId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ChecklistItemDto[]> {
    return this.checklist.remove(id, itemId, user);
  }

  // --- Comments & activity ---

  @Get(':id/comments')
  @ApiOperation({ summary: 'List card comments (viewer)' })
  listComments(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentDto[]> {
    return this.comments.list(id, user);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment with @-mentions (viewer)' })
  addComment(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateCommentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentDto> {
    return this.comments.add(id, body, user);
  }

  @Delete(':id/comments/:commentId')
  @ApiOperation({ summary: 'Delete your comment (author / owner)' })
  removeComment(
    @Param('id', uuidPipe) id: string,
    @Param('commentId', uuidPipe) commentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.comments.remove(id, commentId, user);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: 'Card «История» trail (viewer)' })
  activity(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ActivityDto[]> {
    return this.tasks.listActivity(id, user);
  }

  // --- Links to ЧС / documents ---

  @Get(':id/links')
  @ApiOperation({ summary: 'Card links to ЧС / documents (viewer)' })
  listLinks(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<EntityLinkDto[]> {
    return this.links.listLinks(id, user);
  }

  @Post(':id/links')
  @ApiOperation({ summary: 'Link a card to a ЧС / document (editor)' })
  addLink(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createEntityLinkSchema)) body: CreateEntityLinkInput,
    @CurrentUser() user: AuthUser,
  ): Promise<EntityLinkDto[]> {
    return this.links.addLink(id, body, user);
  }

  @Delete(':id/links/:linkId')
  @ApiOperation({ summary: 'Remove a card link (editor)' })
  removeLink(
    @Param('id', uuidPipe) id: string,
    @Param('linkId', uuidPipe) linkId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<EntityLinkDto[]> {
    return this.links.removeLink(id, linkId, user);
  }
}
