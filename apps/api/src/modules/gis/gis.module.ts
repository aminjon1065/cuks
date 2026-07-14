import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { GisController } from './gis.controller';
import { GisFeaturesService } from './gis-features.service';
import { GisLayersService } from './gis-layers.service';
import { IncidentMapOptionsService } from './incident-map-options.service';
import { TileTokenService } from './tile-token.service';

/**
 * GIS module (docs/modules/10). Tile-access tokens for Martin behind Caddy
 * forward_auth (2.2), incident map filter options (2.4), and the layer registry +
 * drawn-feature editing (2.7). AdminModule supplies AclService for the per-layer
 * ACL (`resource_acl`, resource_type `layer`).
 */
@Module({
  imports: [AdminModule],
  controllers: [GisController],
  providers: [TileTokenService, IncidentMapOptionsService, GisLayersService, GisFeaturesService],
})
export class GisModule {}
