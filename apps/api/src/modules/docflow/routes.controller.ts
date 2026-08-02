import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  type RouteValidationDto,
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
  @ApiCreatedResponse({ description: 'Every route cycle of the document, newest cycle included' })
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
  @ApiOkResponse({ description: 'Each cycle with its steps, assignees and decisions' })
  documentRoutes(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<RouteDto[]> {
    return this.routes.routesForDocument(id, user);
  }

  @Post('route-steps/:id/actions/approve')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Approve an active route step' })
  @ApiCreatedResponse({ description: 'The document’s route cycles after the step was approved' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(approveRouteStepSchema)) body: ApproveRouteStepInput,
  ): Promise<RouteDto[]> {
    return this.routes.act(id, 'approve', body.comment?.trim() || null, user);
  }

  @Post('documents/:id/route/validate')
  @RequirePermission('docflow.create')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dry-run a route definition: who each step would reach and what is wrong',
  })
  @ApiOkResponse({
    description:
      'Per-step findings plus the parallel groups in execution order; nothing is written',
  })
  validateRoute(
    @Param('id', new ZodValidationPipe(uuidSchema)) _id: string,
    @Body(new ZodValidationPipe(startRouteSchema)) body: StartRouteInput,
  ): Promise<RouteValidationDto> {
    return this.routes.validateRoute(body);
  }

  @Post('route-steps/:id/actions/complete')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Report an active `execute` route step as done' })
  @ApiCreatedResponse({ description: 'The document’s route cycles after the step was completed' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(approveRouteStepSchema)) body: ApproveRouteStepInput,
  ): Promise<RouteDto[]> {
    return this.routes.act(id, 'complete', body.comment?.trim() || null, user);
  }

  @Post('route-steps/:id/actions/reject')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Reject an active route step (returns the document to the author)' })
  @ApiCreatedResponse({
    description: 'The route cycles with this one cancelled; the document is back in `draft`',
  })
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
  @ApiOkResponse({ description: 'Templates with their step definitions' })
  listTemplates(): Promise<RouteTemplateDto[]> {
    return this.routes.listTemplates();
  }

  @Post('route-templates')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Create a route template (`docflow.journals.manage`)' })
  @ApiCreatedResponse({ description: 'The new template' })
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRouteTemplateSchema)) body: CreateRouteTemplateInput,
  ): Promise<RouteTemplateDto> {
    return this.routes.createTemplate(body, user);
  }

  @Patch('route-templates/:id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({
    summary:
      'Edit a route template (`docflow.journals.manage`); routes already running are untouched',
  })
  @ApiOkResponse({ description: 'The updated template' })
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateRouteTemplateSchema)) body: UpdateRouteTemplateInput,
  ): Promise<RouteTemplateDto> {
    return this.routes.updateTemplate(id, body, user);
  }

  @Post('route-templates/:id/actions/clone')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Copy a template as a new one, to edit without touching the original' })
  @ApiCreatedResponse({ description: 'The copy, ready to edit' })
  cloneTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<RouteTemplateDto> {
    return this.routes.cloneTemplate(id, user);
  }

  @Delete('route-templates/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Retire a route template (`docflow.journals.manage`) — a soft delete, routes built from it stay',
  })
  @ApiOkResponse({ description: '`{ ok: true }` — 200 with a body, not 204' })
  async removeTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.routes.removeTemplate(id, user);
    return { ok: true };
  }
}
