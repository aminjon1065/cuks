import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { AdminModule } from '../admin/admin.module';
import { GisController } from './gis.controller';
import { GisAccessService } from './gis-access.service';
import { GisDbAccountsService } from './gis-db-accounts.service';
import { GisExportsService } from './gis-exports.service';
import { GisFeaturesService } from './gis-features.service';
import { GisImportsService } from './gis-imports.service';
import { GisDbAccountsController, GisIntegrationController } from './gis-integration.controller';
import { GisLayersService } from './gis-layers.service';
import { GisPublicationService } from './gis-publication.service';
import { GeoServerService } from './geoserver.service';
import { IncidentMapOptionsService } from './incident-map-options.service';
import { TileTokenService } from './tile-token.service';

/**
 * GIS module (docs/modules/10). Tile-access tokens for Martin behind Caddy
 * forward_auth (2.2), incident map filter options (2.4), the layer registry +
 * drawn-feature editing (2.7), the geodata import/export jobs (2.8), and the
 * QGIS/ArcGIS integration (2.9 — GeoServer WMS/WFS publication + managed PostGIS
 * access accounts). AdminModule supplies AclService for the per-layer ACL.
 */
@Module({
  imports: [
    AdminModule,
    BullModule.registerQueue({ name: QUEUE.geoImport }, { name: QUEUE.geoExport }),
  ],
  controllers: [GisController, GisIntegrationController, GisDbAccountsController],
  providers: [
    TileTokenService,
    IncidentMapOptionsService,
    GisLayersService,
    GisFeaturesService,
    GisImportsService,
    GisExportsService,
    GeoServerService,
    GisPublicationService,
    GisAccessService,
    GisDbAccountsService,
  ],
})
export class GisModule {}
