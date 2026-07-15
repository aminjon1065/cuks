import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  approveRouteStepSchema,
  createRouteTemplateSchema,
  rejectRouteStepSchema,
  startRouteSchema,
  updateRouteTemplateSchema,
  type ApproveRouteStepInput,
  type CreateRouteTemplateInput,
  type RejectRouteStepInput,
  type RouteDto,
  type RouteTemplateDto,
  type StartRouteInput,
  type UpdateRouteTemplateInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { RoutesService } from './routes.service';

const uuidSchema = z.string().uuid();

/**
 * Document routes (docs/modules/11 §3/§4, task 3.3): sending a document to a route,
 * approving/rejecting a step, and the route templates. Reading and acting are
 * `docflow.use` (the service enforces authorship / step assignment / visibility);
 * template management is chancellery (`docflow.journals.manage`).
 */
@ApiTags('docflow')
@Controller('docflow')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post('documents/:id/route')
  @RequirePermission('docflow.create')
  @ApiOperation({ summary: 'Send a document to an approval route (from a template or steps)' })
  startRoute(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(startRouteSchema)) body: StartRouteInput,
  ): Promise<RouteDto[]> {
    return this.routes.startRoute(id, body, user);
  }

  @Get('documents/:id/routes')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The route history (cycles) of a document' })
  documentRoutes(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<RouteDto[]> {
    return this.routes.routesForDocument(id, user);
  }

  @Post('route-steps/:id/actions/approve')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Approve an active route step' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(approveRouteStepSchema)) body: ApproveRouteStepInput,
  ): Promise<RouteDto[]> {
    return this.routes.act(id, 'approve', body.comment?.trim() || null, user);
  }

  @Post('route-steps/:id/actions/reject')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Reject an active route step (returns the document to the author)' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(rejectRouteStepSchema)) body: RejectRouteStepInput,
  ): Promise<RouteDto[]> {
    return this.routes.act(id, 'reject', body.comment.trim(), user);
  }

  // --- Templates (chancellery-managed) ---

  @Get('route-templates')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'List route templates' })
  listTemplates(): Promise<RouteTemplateDto[]> {
    return this.routes.listTemplates();
  }

  @Post('route-templates')
  @RequirePermission('docflow.journals.manage')
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRouteTemplateSchema)) body: CreateRouteTemplateInput,
  ): Promise<RouteTemplateDto> {
    return this.routes.createTemplate(body, user);
  }

  @Patch('route-templates/:id')
  @RequirePermission('docflow.journals.manage')
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateRouteTemplateSchema)) body: UpdateRouteTemplateInput,
  ): Promise<RouteTemplateDto> {
    return this.routes.updateTemplate(id, body, user);
  }

  @Delete('route-templates/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(200)
  async removeTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.routes.removeTemplate(id, user);
    return { ok: true };
  }
}
