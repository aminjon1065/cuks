import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createDocumentTemplateSchema,
  createTemplateVersionSchema,
  instantiateDocumentTemplateSchema,
  updateDocumentTemplateSchema,
  type CreateDocumentTemplateInput,
  type CreateTemplateVersionInput,
  type DocumentTemplateDto,
  type InstantiateDocumentTemplateInput,
  type UpdateDocumentTemplateInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocumentTemplatesService } from './document-templates.service';

const uuidSchema = z.string().uuid();
const versionSchema = z.coerce.number().int().min(1);

/**
 * Document templates (docs/modules/11 §12.7). Reading is `docflow.use` — every author
 * picks a blank; managing them is `docflow.journals.manage`, the chancellery's reference-
 * data right, since a template shapes what the whole committee issues.
 */
@ApiTags('docflow')
@Controller('docflow/document-templates')
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @Get()
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List document templates with their versions' })
  @ApiOkResponse({ description: 'Templates, each carrying its version list' })
  list(@CurrentUser() user: AuthUser): Promise<DocumentTemplateDto[]> {
    return this.templates.list(user);
  }

  @Get(':id')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'One template with its version history' })
  @ApiOkResponse({ description: 'The template and every version it has had' })
  detail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.detail(id, user);
  }

  @Post()
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Create a document template' })
  @ApiCreatedResponse({ description: 'The new template — versions are added separately' })
  create(
    @Body(new ZodValidationPipe(createDocumentTemplateSchema)) body: CreateDocumentTemplateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.create(body, user);
  }

  @Patch(':id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Update a template (its code is immutable)' })
  @ApiOkResponse({ description: 'The updated template' })
  update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateDocumentTemplateSchema)) body: UpdateDocumentTemplateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.update(id, body, user);
  }

  @Post(':id/versions')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Add the next draft version (published ones are immutable)' })
  @ApiCreatedResponse({ description: 'The template with the new draft version appended' })
  addVersion(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createTemplateVersionSchema)) body: CreateTemplateVersionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.addVersion(id, body, user);
  }

  @Post(':id/versions/:version/actions/publish')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Publish a draft version, freezing its body' })
  @ApiCreatedResponse({ description: 'The template with that version now published' })
  publish(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('version', new ZodValidationPipe(versionSchema)) version: number,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.publishVersion(id, version, user);
  }

  @Post(':id/actions/deactivate')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Retire a template (its versions stay readable)' })
  @ApiCreatedResponse({ description: 'The template, now inactive; its versions stay readable' })
  deactivate(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentTemplateDto> {
    return this.templates.deactivate(id, user);
  }

  @Post(':id/actions/instantiate')
  @RequirePermission('docflow.create')
  @ApiOperation({ summary: 'Create a draft document from a published template version' })
  @ApiCreatedResponse({ description: 'The id of the draft document that was created' })
  instantiate(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(instantiateDocumentTemplateSchema))
    body: InstantiateDocumentTemplateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<{ documentId: string }> {
    return this.templates.instantiate(id, body, user);
  }
}
