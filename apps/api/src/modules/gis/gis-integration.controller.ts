import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createGisDbAccountSchema,
  type CreateGisDbAccountInput,
  type GisAccessInfoDto,
  type GisDbAccountDto,
  type GisDbAccountSecretDto,
  type GisLayerDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { GisAccessService } from './gis-access.service';
import { GisDbAccountsService } from './gis-db-accounts.service';
import { GisPublicationService } from './gis-publication.service';

const uuidSchema = z.string().uuid();

/**
 * QGIS/ArcGIS integration surface (docs/modules/10 §7, task 2.9): WMS/WFS
 * publication of registry layers, and the connection details GIS specialists need.
 */
@ApiTags('gis')
@Controller('gis')
export class GisIntegrationController {
  constructor(
    private readonly publication: GisPublicationService,
    private readonly access: GisAccessService,
  ) {}

  /** Connection details for the «Для ГИС-специалистов» page. */
  @Get('access-info')
  @RequirePermission('gis.view')
  @ApiOperation({ summary: 'PostGIS + OGC connection details for QGIS/ArcGIS' })
  @ApiOkResponse({ description: 'Direct PostGIS coordinates and OGC endpoints' })
  accessInfo(): GisAccessInfoDto {
    return this.access.getInfo();
  }

  /** Publish a layer to GeoServer WMS/WFS. */
  @Post('layers/:id/publish')
  @RequirePermission('gis.layers.manage')
  @ApiOperation({ summary: 'Publish a layer to GeoServer (WMS/WFS)' })
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<GisLayerDto> {
    return this.publication.publish(id, user);
  }

  @Post('layers/:id/unpublish')
  @RequirePermission('gis.layers.manage')
  @ApiOperation({ summary: 'Remove a layer from GeoServer' })
  unpublish(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<GisLayerDto> {
    return this.publication.unpublish(id, user);
  }
}

/**
 * Managed PostGIS access accounts for direct QGIS/ArcGIS connections (docs/modules/10
 * §7, docs/09 §Права PG). `gis.pg.access` is 2FA-gated (docs/05 §1).
 */
@ApiTags('gis')
@Controller('admin/gis/db-accounts')
export class GisDbAccountsController {
  constructor(private readonly accounts: GisDbAccountsService) {}

  @Get()
  @RequirePermission('gis.pg.access')
  @ApiOperation({ summary: 'List issued PostGIS access accounts' })
  list(): Promise<GisDbAccountDto[]> {
    return this.accounts.list();
  }

  /** Create a scoped PostGIS login role; the password is returned once. */
  @Post()
  @RequirePermission('gis.pg.access')
  @ApiOperation({ summary: 'Issue a PostGIS access account (password shown once)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGisDbAccountSchema)) body: CreateGisDbAccountInput,
  ): Promise<GisDbAccountSecretDto> {
    return this.accounts.create(body, user);
  }

  @Delete(':id')
  @RequirePermission('gis.pg.access')
  @ApiOperation({ summary: 'Revoke a PostGIS access account (drops the role)' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.accounts.remove(id, user);
    return { ok: true };
  }
}
