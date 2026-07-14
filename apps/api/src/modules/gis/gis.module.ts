import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { AdminModule } from '../admin/admin.module';
import { GisController } from './gis.controller';
import { GisExportsService } from './gis-exports.service';
import { GisFeaturesService } from './gis-features.service';
import { GisImportsService } from './gis-imports.service';
import { GisLayersService } from './gis-layers.service';
import { IncidentMapOptionsService } from './incident-map-options.service';
import { TileTokenService } from './tile-token.service';

/**
 * GIS module (docs/modules/10). Tile-access tokens for Martin behind Caddy
 * forward_auth (2.2), incident map filter options (2.4), the layer registry +
 * drawn-feature editing (2.7), and the geodata import/export jobs (2.8 — the work
 * runs in the worker; this side records what to do and queues it). AdminModule
 * supplies AclService for the per-layer ACL (`resource_acl`, resource_type `layer`).
 */
@Module({
  imports: [
    AdminModule,
    BullModule.registerQueue({ name: QUEUE.geoImport }, { name: QUEUE.geoExport }),
  ],
  controllers: [GisController],
  providers: [
    TileTokenService,
    IncidentMapOptionsService,
    GisLayersService,
    GisFeaturesService,
    GisImportsService,
    GisExportsService,
  ],
})
export class GisModule {}
