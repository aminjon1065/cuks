import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  correspondentsQuerySchema,
  createCorrespondentSchema,
  createJournalSchema,
  createNomenclatureSchema,
  updateCorrespondentSchema,
  updateJournalSchema,
  updateNomenclatureSchema,
  type CorrespondentDto,
  type CorrespondentsQuery,
  type CreateCorrespondentInput,
  type CreateJournalInput,
  type CreateNomenclatureInput,
  type CorrespondentCategoryDto,
  type DocumentTypeDto,
  type JournalDto,
  type NomenclatureDto,
  type UpdateCorrespondentInput,
  type UpdateJournalInput,
  type UpdateNomenclatureInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { CorrespondentsService } from './correspondents.service';
import { DocflowDictionariesService } from './docflow-dictionaries.service';
import { JournalsService } from './journals.service';
import { NomenclatureService } from './nomenclature.service';

const uuidSchema = z.string().uuid();

/**
 * Docflow reference data (docs/modules/11 §1/§3, task 3.1): registration journals,
 * correspondents, the case-index nomenclature and the document-type list. Journals
 * and nomenclature are chancellery-managed (`docflow.journals.manage`); the
 * correspondent directory is read/created by anyone with `docflow.use` (the
 * registration wizard searches and adds inline).
 */
@ApiTags('docflow')
@Controller('docflow')
export class DocflowController {
  constructor(
    private readonly journals: JournalsService,
    private readonly correspondents: CorrespondentsService,
    private readonly nomenclature: NomenclatureService,
    private readonly dictionaries: DocflowDictionariesService,
  ) {}

  // --- Journals ---

  @Get('journals')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List registration journals' })
  @ApiOkResponse({ description: 'Journals with their number template and sequence-reset rule' })
  listJournals(): Promise<JournalDto[]> {
    return this.journals.list();
  }

  @Post('journals')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Create a registration journal' })
  @ApiCreatedResponse({ description: 'The new journal' })
  createJournal(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createJournalSchema)) body: CreateJournalInput,
  ): Promise<JournalDto> {
    return this.journals.create(body, user);
  }

  @Patch('journals/:id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({
    summary:
      'Edit a registration journal (`docflow.journals.manage`) — numbers already minted are untouched',
  })
  @ApiOkResponse({ description: 'The updated journal' })
  patchJournal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateJournalSchema)) body: UpdateJournalInput,
  ): Promise<JournalDto> {
    return this.journals.update(id, body, user);
  }

  @Delete('journals/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Retire a registration journal (`docflow.journals.manage`) — a soft delete; documents already registered in it keep their numbers',
  })
  @ApiOkResponse({ description: '`{ ok: true }` — 200 with a body, not 204' })
  async removeJournal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.journals.remove(id, user);
    return { ok: true };
  }

  // --- Correspondents ---

  @Get('correspondents')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List/search correspondents' })
  @ApiOkResponse({ description: 'Correspondents matching the query, with their category' })
  listCorrespondents(
    @Query(new ZodValidationPipe(correspondentsQuerySchema)) query: CorrespondentsQuery,
  ): Promise<CorrespondentDto[]> {
    return this.correspondents.list(query);
  }

  @Post('correspondents')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Create a correspondent (inline from the registration wizard)' })
  @ApiCreatedResponse({ description: 'The new correspondent' })
  createCorrespondent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCorrespondentSchema)) body: CreateCorrespondentInput,
  ): Promise<CorrespondentDto> {
    return this.correspondents.create(body, user);
  }

  // Editing an existing shared directory entry is a management action (like removal),
  // reserved for the chancellery — only create-on-the-fly is open to docflow.use.
  @Patch('correspondents/:id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({
    summary:
      'Edit a correspondent — needs `docflow.journals.manage`, unlike creating one, which any `docflow.use` may do',
  })
  @ApiOkResponse({ description: 'The updated correspondent' })
  patchCorrespondent(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateCorrespondentSchema)) body: UpdateCorrespondentInput,
  ): Promise<CorrespondentDto> {
    return this.correspondents.update(id, body, user);
  }

  @Delete('correspondents/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Retire a correspondent (`docflow.journals.manage`) — a soft delete; documents that name it are untouched',
  })
  @ApiOkResponse({ description: '`{ ok: true }` — 200 with a body, not 204' })
  async removeCorrespondent(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.correspondents.remove(id, user);
    return { ok: true };
  }

  // --- Nomenclature (case index) ---

  @Get('nomenclature')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List the case-index nomenclature' })
  @ApiOkResponse({ description: 'Cases with their index, title and retention term' })
  listNomenclature(): Promise<NomenclatureDto[]> {
    return this.nomenclature.list();
  }

  @Post('nomenclature')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Add a case to the nomenclature (`docflow.journals.manage`)' })
  @ApiCreatedResponse({ description: 'The new case' })
  createNomenclature(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNomenclatureSchema)) body: CreateNomenclatureInput,
  ): Promise<NomenclatureDto> {
    return this.nomenclature.create(body, user);
  }

  @Patch('nomenclature/:id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({
    summary:
      'Edit a nomenclature case (`docflow.journals.manage`) — retention terms already frozen on filed documents do not move',
  })
  @ApiOkResponse({ description: 'The updated case' })
  patchNomenclature(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateNomenclatureSchema)) body: UpdateNomenclatureInput,
  ): Promise<NomenclatureDto> {
    return this.nomenclature.update(id, body, user);
  }

  @Delete('nomenclature/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Retire a nomenclature case (`docflow.journals.manage`) — a soft delete; documents filed into it stay filed',
  })
  @ApiOkResponse({ description: '`{ ok: true }` — 200 with a body, not 204' })
  async removeNomenclature(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.nomenclature.remove(id, user);
    return { ok: true };
  }

  // --- Dictionary-backed options (read-only) ---

  @Get('document-types')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List active document types for registration forms' })
  @ApiOkResponse({ description: 'Active types only — retired ones are never offered' })
  listDocumentTypes(): Promise<DocumentTypeDto[]> {
    return this.dictionaries.documentTypes();
  }

  @Get('correspondent-categories')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List active correspondent categories' })
  @ApiOkResponse({ description: 'Active categories only' })
  listCorrespondentCategories(): Promise<CorrespondentCategoryDto[]> {
    return this.dictionaries.correspondentCategories();
  }
}
