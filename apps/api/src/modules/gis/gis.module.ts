import { Module } from '@nestjs/common';
import { GisController } from './gis.controller';
import { TileTokenService } from './tile-token.service';
import { IncidentMapOptionsService } from './incident-map-options.service';

/** GIS module (docs/modules/10). Phase 2.2: tile-access tokens for Martin behind
 *  Caddy forward_auth. Incident/layer/import endpoints land in later phases. */
@Module({
  controllers: [GisController],
  providers: [TileTokenService, IncidentMapOptionsService],
})
export class GisModule {}
