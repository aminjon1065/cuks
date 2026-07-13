import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  completeUploadSchema,
  createFileLinkSchema,
  createFolderSchema,
  grantNodeAclSchema,
  initiateUploadSchema,
  patchNodeSchema,
  previewQuerySchema,
  quotaQuerySchema,
  revokeNodeAclSchema,
  treeQuerySchema,
  trashQuerySchema,
  type CompleteUploadInput,
  type CreateFileLinkInput,
  type CreateFolderInput,
  type FileLinkDto,
  type FileVersionDto,
  type FsNodeDto,
  type GrantNodeAclInput,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type NodeAclEntryDto,
  type NodeAclResponse,
  type PatchNodeInput,
  type PreviewQuery,
  type PreviewSize,
  type QuotaDto,
  type QuotaQuery,
  type RevokeNodeAclInput,
  type TreeQuery,
  type TreeResponse,
  type TrashQuery,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { FileSharingService } from './file-sharing.service';
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
    private readonly sharing: FileSharingService,
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

  /** "Доступные мне" — everything shared with the user (docs/modules/12 §2). */
  @Get('shared')
  getShared(@CurrentUser() user: AuthUser): Promise<FsNodeDto[]> {
    return this.sharing.listSharedWithMe(user);
  }

  /** Resolve an internal link: grants the caller `viewer` and returns the node. */
  @Post('links/:token/accept')
  @HttpCode(200)
  acceptLink(@CurrentUser() user: AuthUser, @Param('token') token: string): Promise<FsNodeDto> {
    return this.sharing.acceptLink(token, user);
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

  // --- Sharing: ACL grants + internal links (task 1.4) ---

  @Get(':id/acl')
  getAcl(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<NodeAclResponse> {
    return this.sharing.getAcl(id, user);
  }

  @Put(':id/acl')
  grantAcl(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(grantNodeAclSchema)) body: GrantNodeAclInput,
  ): Promise<NodeAclEntryDto> {
    return this.sharing.grantAcl(id, body, user);
  }

  @Delete(':id/acl')
  @HttpCode(200)
  async revokeAcl(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(revokeNodeAclSchema)) body: RevokeNodeAclInput,
  ): Promise<{ ok: true }> {
    await this.sharing.revokeAcl(id, body, user);
    return { ok: true };
  }

  @Get(':id/links')
  listLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<FileLinkDto[]> {
    return this.sharing.listLinks(id, user);
  }

  @Post(':id/links')
  createLink(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createFileLinkSchema)) body: CreateFileLinkInput,
  ): Promise<FileLinkDto> {
    return this.sharing.createLink(id, body.expiresInDays ?? null, user);
  }

  @Delete(':id/links/:linkId')
  @HttpCode(200)
  async revokeLink(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('linkId', new ZodValidationPipe(uuidSchema)) linkId: string,
  ): Promise<{ ok: true }> {
    await this.sharing.revokeLink(id, linkId, user);
    return { ok: true };
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
