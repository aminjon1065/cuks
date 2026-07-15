import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addDocumentFileSchema,
  changeDocumentStatusSchema,
  createDocumentSchema,
  listDocumentsQuerySchema,
  registerDocumentSchema,
  updateDocumentSchema,
  type AddDocumentFileInput,
  type ChangeDocumentStatusInput,
  type CreateDocumentInput,
  type DocumentDetailDto,
  type DocumentHistoryEntryDto,
  type DocumentListItemDto,
  type DocumentQueueCountsDto,
  type ListDocumentsQuery,
  type PaginatedResult,
  type RegisterDocumentInput,
  type UpdateDocumentInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocumentsService } from './documents.service';

const uuidSchema = z.string().uuid();

/**
 * Document cards (docs/modules/11 §3/§4, task 3.2). Reading is `docflow.use` (with
 * per-document visibility enforced in the service — ДСП stays allow-list-only);
 * authoring is `docflow.create`; registration (number minting) is `docflow.register`.
 */
@ApiTags('docflow')
@Controller('docflow/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List documents by queue (mine / drafts / authored / registry)' })
  list(
    @Query(new ZodValidationPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<DocumentListItemDto>> {
    return this.documents.list(query, user);
  }

  // Declared before `:id` so the literal path is not captured by the uuid param.
  @Get('queue-counts')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Pending-work counts for the cabinet queue badges' })
  queueCounts(@CurrentUser() user: AuthUser): Promise<DocumentQueueCountsDto> {
    return this.documents.queueCounts(user);
  }

  @Post()
  @RequirePermission('docflow.create')
  @ApiOperation({ summary: 'Create a draft document' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: CreateDocumentInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.create(body, user);
  }

  @Get(':id')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Get a document card' })
  detail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.documents.detail(id, user);
  }

  @Get(':id/history')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's audit history (История tab)" })
  history(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentHistoryEntryDto[]> {
    return this.documents.history(id, user);
  }

  @Patch(':id')
  @RequirePermission('docflow.create')
  @ApiOperation({ summary: 'Edit a draft document (author only)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: UpdateDocumentInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.update(id, body, user);
  }

  @Post(':id/files')
  @RequirePermission('docflow.create')
  @ApiOperation({ summary: 'Attach a file (main body or attachment) to a draft' })
  addFile(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(addDocumentFileSchema)) body: AddDocumentFileInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.addFile(id, body, user);
  }

  @Post(':id/actions/register')
  @RequirePermission('docflow.register')
  @ApiOperation({ summary: 'Register the document: assign a journal and mint its number' })
  register(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(registerDocumentSchema)) body: RegisterDocumentInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.register(id, body, user);
  }

  @Post(':id/actions/status')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Advance / roll back the document status' })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(changeDocumentStatusSchema)) body: ChangeDocumentStatusInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.changeStatus(id, body, user);
  }
}
