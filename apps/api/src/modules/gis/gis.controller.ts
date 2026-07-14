import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createGisFeatureSchema,
  createGisLayerSchema,
  gisFeaturesQuerySchema,
  patchGisFeatureSchema,
  patchGisLayerSchema,
  type CreateGisFeatureInput,
  type CreateGisLayerInput,
  type GisFeatureDto,
  type GisFeaturesQuery,
  type GisLayerDto,
  type IncidentMapFilterOptionsResponse,
  type PatchGisFeatureInput,
  type PatchGisLayerInput,
  type TileTokenResponse,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { GisFeaturesService } from './gis-features.service';
import { GisLayersService } from './gis-layers.service';
import { TileTokenService } from './tile-token.service';
import { IncidentMapOptionsService } from './incident-map-options.service';

const uuidSchema = z.string().uuid();

/** Extract `?token=` from the original request URI that Caddy's forward_auth
 *  forwards in `X-Forwarded-Uri` (e.g. `/tiles/incidents/8/1/2?token=…`). */
function tokenFromForwardedUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const q = uri.indexOf('?');
  if (q < 0) return undefined;
  return new URLSearchParams(uri.slice(q + 1)).get('token') ?? undefined;
}

/**
 * GIS tile access (docs/modules/10 §9), the layer registry and drawn-feature
 * editing (§3/§4). The map fetches a short-lived signed token, appends it to
 * Martin tile URLs, and Caddy `forward_auth` calls `tile-auth` to validate it
 * before proxying to Martin.
 *
 * Permissions follow docs/05: creating/configuring a layer is `gis.layers.manage`,
 * editing the objects *on* a layer is `gis.layers.edit`. Both are additionally
 * subject to the per-layer ACL (`resource_acl`, resource_type `layer`).
 */
@ApiTags('gis')
@Controller('gis')
export class GisController {
  constructor(
    private readonly tiles: TileTokenService,
    private readonly mapOptions: IncidentMapOptionsService,
    private readonly layers: GisLayersService,
    private readonly features: GisFeaturesService,
  ) {}

  /** Active leaf incident types + administrative regions for the map filters. */
  @Get('incidents/filter-options')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'Get reference options for incident map filters' })
  @ApiOkResponse({ description: 'Incident type and region options' })
  incidentFilterOptions(): Promise<IncidentMapFilterOptionsResponse> {
    return this.mapOptions.getOptions();
  }

  /** Issue a tile token for the current map session (requires `gis.view`). */
  @Get('tile-token')
  @RequirePermission('gis.view')
  issueTileToken(): TileTokenResponse {
    const { token, expiresAt } = this.tiles.issue();
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * forward_auth target — no session (the token is the sole capability): Caddy
   * calls this before proxying `/tiles/*`. 2xx = allow, 401 = deny. The token
   * comes from the request's own `?token=` or the forwarded original URI.
   */
  @Get('tile-auth')
  @Public()
  tileAuth(
    @Query('token') queryToken: string | undefined,
    @Headers('x-forwarded-uri') forwardedUri: string | undefined,
  ): { ok: true } {
    const token = queryToken ?? tokenFromForwardedUri(forwardedUri);
    if (!this.tiles.verify(token)) {
      throw AppException.unauthorized('gis.tile.invalid_token', 'Invalid or expired tile token');
    }
    return { ok: true };
  }

  // --- Layer registry (docs/modules/10 §3/§9, task 2.7) ---

  /** Layers the map can show; `canEdit`/`canManage` reflect the caller's ACL. */
  @Get('layers')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'List map layers' })
  listLayers(@CurrentUser() user: AuthUser): Promise<GisLayerDto[]> {
    return this.layers.list(user);
  }

  /** Create a drawn (annotation) layer; the creator becomes its manager. */
  @Post('layers')
  @RequirePermission('gis.layers.manage')
  @ApiOperation({ summary: 'Create a drawn layer' })
  createLayer(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGisLayerSchema)) body: CreateGisLayerInput,
  ): Promise<GisLayerDto> {
    return this.layers.create(body, user);
  }

  @Patch('layers/:id')
  @RequirePermission('gis.layers.manage')
  patchLayer(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(patchGisLayerSchema)) body: PatchGisLayerInput,
  ): Promise<GisLayerDto> {
    return this.layers.patch(id, body, user);
  }

  @Delete('layers/:id')
  @RequirePermission('gis.layers.manage')
  @HttpCode(200)
  async removeLayer(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.layers.remove(id, user);
    return { ok: true };
  }

  // --- Drawn features (docs/modules/10 §4: inspector + terra-draw editing) ---

  @Get('features')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'List features of a drawn layer (optionally by bbox)' })
  @ApiOkResponse({ description: 'GeoJSON geometries with their attributes' })
  listFeatures(
    @Query(new ZodValidationPipe(gisFeaturesQuerySchema)) query: GisFeaturesQuery,
  ): Promise<GisFeatureDto[]> {
    return this.features.list(query);
  }

  @Get('features/:id')
  @RequirePermission('gis.view')
  getFeature(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<GisFeatureDto> {
    return this.features.getOne(id);
  }

  @Post('features')
  @RequirePermission('gis.layers.edit')
  createFeature(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGisFeatureSchema)) body: CreateGisFeatureInput,
  ): Promise<GisFeatureDto> {
    return this.features.create(body, user);
  }

  /** Geometry and/or attributes; the previous geometry is kept in the audit log. */
  @Patch('features/:id')
  @RequirePermission('gis.layers.edit')
  patchFeature(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(patchGisFeatureSchema)) body: PatchGisFeatureInput,
  ): Promise<GisFeatureDto> {
    return this.features.patch(id, body, user);
  }

  @Delete('features/:id')
  @RequirePermission('gis.layers.edit')
  @HttpCode(200)
  async removeFeature(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.features.remove(id, user);
    return { ok: true };
  }
}
