import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IncidentMapFilterOptionsResponse, TileTokenResponse } from '@cuks/shared';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { TileTokenService } from './tile-token.service';
import { IncidentMapOptionsService } from './incident-map-options.service';

/** Extract `?token=` from the original request URI that Caddy's forward_auth
 *  forwards in `X-Forwarded-Uri` (e.g. `/tiles/incidents/8/1/2?token=…`). */
function tokenFromForwardedUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const q = uri.indexOf('?');
  if (q < 0) return undefined;
  return new URLSearchParams(uri.slice(q + 1)).get('token') ?? undefined;
}

/**
 * GIS tile access (docs/modules/10 §9). The map fetches a short-lived signed
 * token, appends it to Martin tile URLs, and Caddy `forward_auth` calls
 * `tile-auth` to validate it before proxying to Martin.
 */
@ApiTags('gis')
@Controller('gis')
export class GisController {
  constructor(
    private readonly tiles: TileTokenService,
    private readonly mapOptions: IncidentMapOptionsService,
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
}
