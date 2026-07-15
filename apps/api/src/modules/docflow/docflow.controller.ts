import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  listJournals(): Promise<JournalDto[]> {
    return this.journals.list();
  }

  @Post('journals')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Create a registration journal' })
  createJournal(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createJournalSchema)) body: CreateJournalInput,
  ): Promise<JournalDto> {
    return this.journals.create(body, user);
  }

  @Patch('journals/:id')
  @RequirePermission('docflow.journals.manage')
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
  listCorrespondents(
    @Query(new ZodValidationPipe(correspondentsQuerySchema)) query: CorrespondentsQuery,
  ): Promise<CorrespondentDto[]> {
    return this.correspondents.list(query);
  }

  @Post('correspondents')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Create a correspondent (inline from the registration wizard)' })
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
  listNomenclature(): Promise<NomenclatureDto[]> {
    return this.nomenclature.list();
  }

  @Post('nomenclature')
  @RequirePermission('docflow.journals.manage')
  createNomenclature(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNomenclatureSchema)) body: CreateNomenclatureInput,
  ): Promise<NomenclatureDto> {
    return this.nomenclature.create(body, user);
  }

  @Patch('nomenclature/:id')
  @RequirePermission('docflow.journals.manage')
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
  listDocumentTypes(): Promise<DocumentTypeDto[]> {
    return this.dictionaries.documentTypes();
  }

  @Get('correspondent-categories')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List active correspondent categories' })
  listCorrespondentCategories(): Promise<CorrespondentCategoryDto[]> {
    return this.dictionaries.correspondentCategories();
  }
}
