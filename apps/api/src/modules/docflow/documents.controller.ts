import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Redirect } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addDocumentCollaboratorSchema,
  addDocumentFileSchema,
  previewQuerySchema,
  type PreviewQuery,
  type PreviewSize,
  changeDocumentStatusSchema,
  createDocumentSchema,
  listDocumentsQuerySchema,
  registerDocumentSchema,
  registerIncomingSchema,
  setDocumentAccessSchema,
  updateDocumentSchema,
  type AddDocumentCollaboratorInput,
  type AddDocumentFileInput,
  type ChangeDocumentStatusInput,
  type CreateDocumentInput,
  type DocumentAccessDto,
  type DocumentCollaboratorDto,
  type DocumentDetailDto,
  type DocumentHistoryEntryDto,
  type DocumentTimelineEntryDto,
  type DocumentListItemDto,
  type DocumentQueueCountsDto,
  type ListDocumentsQuery,
  type PaginatedResult,
  type ReadLogEntryDto,
  type RegisterDocumentInput,
  type RegisterIncomingInput,
  type SetDocumentAccessInput,
  type UpdateDocumentInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocflowFilesService } from './docflow-files.service';
import { DocumentCollaboratorsService } from './document-collaborators.service';
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
  constructor(
    private readonly documents: DocumentsService,
    private readonly files: DocflowFilesService,
    private readonly collaborators: DocumentCollaboratorsService,
  ) {}

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

  // Literal path — declared before the `:id` handlers so it is never taken for a uuid.
  @Post('register-incoming')
  @RequirePermission('docflow.register')
  @ApiOperation({
    summary: 'Create and register an incoming document atomically (idempotent on a client key)',
  })
  registerIncoming(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerIncomingSchema)) body: RegisterIncomingInput,
  ): Promise<DocumentDetailDto> {
    return this.documents.registerIncoming(body, user);
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

  @Get(':id/timeline')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "The document's unified timeline (audited business events)" })
  timeline(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTimelineEntryDto[]> {
    return this.documents.timeline(id, user);
  }

  @Get(':id/collaborators')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Who besides the author works on the document' })
  listCollaborators(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentCollaboratorDto[]> {
    return this.collaborators.list(id, user);
  }

  @Post(':id/collaborators')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Assign a preparer / editor / viewer (author only)' })
  addCollaborator(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(addDocumentCollaboratorSchema))
    body: AddDocumentCollaboratorInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentCollaboratorDto[]> {
    return this.collaborators.add(id, body, user);
  }

  @Delete(':id/collaborators/:collaboratorId')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Revoke a collaborator (author only)' })
  removeCollaborator(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('collaboratorId', new ZodValidationPipe(uuidSchema)) collaboratorId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentCollaboratorDto[]> {
    return this.collaborators.remove(id, collaboratorId, user);
  }

  @Get(':id/access')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Get the confidentiality grif + access list (ДСП allow-list)' })
  getAccess(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentAccessDto> {
    return this.documents.getAccess(id, user);
  }

  @Patch(':id/access')
  @RequirePermission('docflow.use')
  @ApiOperation({
    summary: 'Set the confidentiality grif + access list (author / confidential.view)',
  })
  setAccess(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(setDocumentAccessSchema)) body: SetDocumentAccessInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentAccessDto> {
    return this.documents.setAccess(id, body, user);
  }

  @Get(':id/read-log')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The ДСП access trail (author / confidential.view)' })
  readLog(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ReadLogEntryDto[]> {
    return this.documents.readLogFor(id, user);
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

  @Get(':id/files/:fileId/download')
  @RequirePermission('docflow.use')
  @Redirect()
  @ApiOperation({
    summary: "Download a document's file (document visibility + ДСП + antivirus gate)",
  })
  async downloadFile(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('fileId', new ZodValidationPipe(uuidSchema)) fileId: string,
  ): Promise<{ url: string; statusCode: number }> {
    // A short-lived presigned URL, never a permanent object link (docs/modules/11 §12.2).
    return { url: await this.files.downloadUrl(id, fileId, user), statusCode: 302 };
  }

  @Get(':id/files/:fileId/preview')
  @RequirePermission('docflow.use')
  @Redirect()
  @ApiOperation({ summary: "A preview tile for a document's file (same access gate)" })
  async previewFile(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('fileId', new ZodValidationPipe(uuidSchema)) fileId: string,
    @Query(new ZodValidationPipe(previewQuerySchema)) query: PreviewQuery,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.files.previewUrl(id, fileId, query.size as PreviewSize, user);
    return { url, statusCode: 302 };
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
