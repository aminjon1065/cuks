import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  completeUploadSchema,
  createFolderSchema,
  initiateUploadSchema,
  patchNodeSchema,
  previewQuerySchema,
  quotaQuerySchema,
  treeQuerySchema,
  trashQuerySchema,
  type CompleteUploadInput,
  type CreateFolderInput,
  type FileVersionDto,
  type FsNodeDto,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type PatchNodeInput,
  type PreviewQuery,
  type PreviewSize,
  type QuotaDto,
  type QuotaQuery,
  type TreeQuery,
  type TreeResponse,
  type TrashQuery,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { FileVersionsService } from './file-versions.service';
import { FsNodesService } from './fs-nodes.service';
import { FsTreeService } from './fs-tree.service';
import { UploadsService } from './uploads.service';

const uuidSchema = z.string().uuid();
const versionParamSchema = z.coerce.number().int().positive();

@ApiTags('files')
@RequirePermission('files.use')
@Controller('files')
export class FilesController {
  constructor(
    private readonly tree_: FsTreeService,
    private readonly nodes: FsNodesService,
    private readonly uploads: UploadsService,
    private readonly versions: FileVersionsService,
  ) {}

  @Get('tree')
  getTree(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(treeQuerySchema)) query: TreeQuery,
  ): Promise<TreeResponse> {
    return this.tree_.tree(query, user);
  }

  @Get('trash')
  getTrash(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(trashQuerySchema)) query: TrashQuery,
  ): Promise<FsNodeDto[]> {
    return this.tree_.listTrash(query.space, query.orgUnitId, user);
  }

  @Get('quota')
  getQuota(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(quotaQuerySchema)) query: QuotaQuery,
  ): Promise<QuotaDto> {
    return this.nodes.getQuota(query.space, query.orgUnitId, user);
  }

  @Post('folders')
  createFolder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFolderSchema)) body: CreateFolderInput,
  ): Promise<FsNodeDto> {
    return this.tree_.createFolder(body, user);
  }

  @Post('uploads')
  initiateUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(initiateUploadSchema)) body: InitiateUploadInput,
  ): Promise<InitiateUploadResponse> {
    return this.uploads.initiate(body, user);
  }

  @Post('uploads/:id/complete')
  completeUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(completeUploadSchema)) body: CompleteUploadInput,
  ): Promise<FsNodeDto> {
    return this.uploads.complete(id, body, user);
  }

  @Post('uploads/:id/abort')
  @HttpCode(200)
  async abortUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.uploads.abort(id, user);
    return { ok: true };
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ node: FsNodeDto; breadcrumbs: TreeResponse['breadcrumbs'] }> {
    return this.tree_.getOne(id, user);
  }

  @Get(':id/download')
  @Redirect()
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.nodes.getDownloadUrl(id, user);
    return { url, statusCode: 302 };
  }

  @Get(':id/preview')
  @Redirect()
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(previewQuerySchema)) query: PreviewQuery,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.nodes.getPreviewUrl(id, query.size as PreviewSize, user);
    return { url, statusCode: 302 };
  }

  @Get(':id/versions')
  listVersions(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<FileVersionDto[]> {
    return this.versions.list(id, user);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('version', new ZodValidationPipe(versionParamSchema)) version: number,
  ): Promise<FsNodeDto> {
    return this.versions.restoreAsNew(id, version, user);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<FsNodeDto> {
    return this.tree_.restore(id, user);
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(patchNodeSchema)) body: PatchNodeInput,
  ): Promise<FsNodeDto> {
    return this.tree_.patch(id, body, user);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.tree_.remove(id, user);
    return { ok: true };
  }
}
