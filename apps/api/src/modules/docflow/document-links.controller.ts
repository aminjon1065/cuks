import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createDocumentLinkSchema,
  type CreateDocumentLinkInput,
  type DocumentLinkDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocumentLinksService } from './document-links.service';

const uuidSchema = z.string().uuid();

/** Document links / связи (docs/modules/11 §3/§7, task 3.7). Reading/managing links needs
 *  only `docflow.use`; the service enforces per-document visibility on both ends. */
@ApiTags('docflow')
@Controller('docflow/documents')
export class DocumentLinksController {
  constructor(private readonly links: DocumentLinksService) {}

  @Get(':id/links')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Related documents (bidirectional)' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<DocumentLinkDto[]> {
    return this.links.forDocument(id, user);
  }

  @Post(':id/links')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Link this document to another' })
  add(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createDocumentLinkSchema)) body: CreateDocumentLinkInput,
  ): Promise<DocumentLinkDto[]> {
    return this.links.add(id, body, user);
  }

  @Delete(':id/links/:linkId')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Remove a document link' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('linkId', new ZodValidationPipe(uuidSchema)) linkId: string,
  ): Promise<DocumentLinkDto[]> {
    return this.links.remove(id, linkId, user);
  }
}
