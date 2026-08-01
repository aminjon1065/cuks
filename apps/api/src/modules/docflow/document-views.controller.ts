import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  saveDocumentViewSchema,
  updateDocumentViewSchema,
  type DocumentViewDto,
  type SaveDocumentViewInput,
  type UpdateDocumentViewInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocumentViewsService } from './document-views.service';

const uuidSchema = z.string().uuid();

/**
 * Saved register views (plan этап 9, §7.8). Gated by `docflow.use` alone: a preset is a set of
 * filters, and the list it opens re-applies the caller's own visibility — so keeping one, or
 * being offered a colleague's, discloses nothing the register would not.
 */
@ApiTags('docflow')
@Controller('docflow/views')
export class DocumentViewsController {
  constructor(private readonly views: DocumentViewsService) {}

  @Get()
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'My saved register views, plus the ones colleagues shared' })
  list(@CurrentUser() user: AuthUser): Promise<DocumentViewDto[]> {
    return this.views.list(user);
  }

  @Post()
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Save the current filters as a named view' })
  create(
    @Body(new ZodValidationPipe(saveDocumentViewSchema)) body: SaveDocumentViewInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentViewDto> {
    return this.views.create(body, user);
  }

  @Patch(':id')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Rename a view, re-save its filters, or share it' })
  update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateDocumentViewSchema)) body: UpdateDocumentViewInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentViewDto> {
    return this.views.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermission('docflow.use')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one of my views' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.views.remove(id, user);
  }
}
