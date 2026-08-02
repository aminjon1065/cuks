import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  archiveDocumentSchema,
  archiveQuerySchema,
  createDispositionBatchSchema,
  dispositionDecisionSchema,
  dispositionItemsSchema,
  legalHoldSchema,
  restoreDocumentSchema,
  type ArchiveDocumentInput,
  type ArchiveEntryDto,
  type ArchiveQuery,
  type CreateDispositionBatchInput,
  type DispositionBatchDto,
  type DispositionDecisionInput,
  type DispositionItemsInput,
  type DocumentDetailDto,
  type LegalHoldInput,
  type PaginatedResult,
  type RestoreDocumentInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ArchiveService } from './archive.service';

const uuidSchema = z.string().uuid();

/**
 * Archive, legal hold and acts of disposal (docs/modules/11 §12.12, plan §7.8).
 *
 * The permission on each route is the WEAKEST one that can reach it; the service then checks
 * the specific right the act needs (`docflow.archive.hold` for a hold,
 * `docflow.archive.dispose` for an act) and the caller's visibility of the specific document.
 * Nothing here deletes an object from storage — disposal is logical in this release.
 */
@ApiTags('docflow')
@Controller('docflow')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get('archive')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The archive inventory: what is filed where, and until when' })
  @ApiOkResponse({
    description:
      'A page of inventory rows with their case, retention date, hold and disposal state',
  })
  list(
    @Query(new ZodValidationPipe(archiveQuerySchema)) query: ArchiveQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<ArchiveEntryDto>> {
    return this.archive.list(query, user);
  }

  @Get('archive/export')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The inventory as an XLSX «опись», over the visible rows only' })
  @ApiOkResponse({ description: 'XLSX workbook attachment' })
  async exportInventory(
    @Query(new ZodValidationPipe(archiveQuerySchema)) query: ArchiveQuery,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    reply.header('content-disposition', 'attachment; filename="archive.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return this.archive.inventoryXlsx(query, user);
  }

  @Post('documents/:id/actions/archive')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'File the document into its case, freezing its retention term' })
  @ApiOkResponse({ description: 'The document card, its `archive` block now filled in' })
  archiveDocument(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(archiveDocumentSchema)) body: ArchiveDocumentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.archive(id, body, user);
  }

  @Post('documents/:id/actions/restore')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take the document back out of the archive, with a reason' })
  @ApiOkResponse({ description: 'The document card, no longer filed' })
  restoreDocument(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(restoreDocumentSchema)) body: RestoreDocumentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.restore(id, body, user);
  }

  @Post('documents/:id/actions/legal-hold')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a legal hold: the document can no longer be disposed of' })
  @ApiOkResponse({ description: 'The document card with the hold and its reason' })
  setLegalHold(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(legalHoldSchema)) body: LegalHoldInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.setLegalHold(id, body, user);
  }

  @Delete('documents/:id/legal-hold')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift the legal hold, with a reason' })
  @ApiOkResponse({ description: 'The document card with the hold lifted' })
  clearLegalHold(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(legalHoldSchema)) body: LegalHoldInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDetailDto> {
    return this.archive.clearLegalHold(id, body, user);
  }

  // --- Acts of disposal -------------------------------------------------------------

  @Get('archive/disposition-batches')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Acts of disposal, newest first' })
  @ApiOkResponse({
    description:
      'Acts with the rows the caller may see, plus how many are withheld and whether they may decide',
  })
  listBatches(@CurrentUser() user: AuthUser): Promise<DispositionBatchDto[]> {
    return this.archive.listBatches(user);
  }

  @Post('archive/disposition-batches')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Draft an act of disposal' })
  @ApiCreatedResponse({ description: 'The draft act with its number' })
  createBatch(
    @Body(new ZodValidationPipe(createDispositionBatchSchema)) body: CreateDispositionBatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.createBatch(body, user);
  }

  @Post('archive/disposition-batches/:id/items')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add documents to a draft act' })
  @ApiOkResponse({ description: 'The act with its item list after the addition' })
  addItems(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionItemsSchema)) body: DispositionItemsInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.addItems(id, body, user);
  }

  @Post('archive/disposition-batches/:id/actions/submit')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hand the act to a reviewer' })
  @ApiOkResponse({ description: 'The act, now awaiting a decision' })
  submitBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.submitBatch(id, user);
  }

  @Post('archive/disposition-batches/:id/actions/approve')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the act — never its own author' })
  @ApiOkResponse({ description: 'The approved act, ready to be carried out' })
  approveBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionDecisionSchema)) body: DispositionDecisionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.decideBatch(id, 'approve', body, user);
  }

  @Post('archive/disposition-batches/:id/actions/reject')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return the act, leaving its documents ordinary archived records' })
  @ApiOkResponse({ description: 'The rejected act with the decision comment' })
  rejectBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dispositionDecisionSchema)) body: DispositionDecisionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.decideBatch(id, 'reject', body, user);
  }

  @Post('archive/disposition-batches/:id/actions/execute')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Carry out an approved act — logical disposal, nothing is deleted' })
  @ApiOkResponse({
    description: 'The executed act; its documents are marked disposed, no object leaves storage',
  })
  executeBatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DispositionBatchDto> {
    return this.archive.executeBatch(id, user);
  }
}
