import { Injectable } from '@nestjs/common';
import type { GisAccessInfoDto } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';
import { GeoServerService } from './geoserver.service';

/**
 * Connection details for GIS specialists (docs/modules/10 §7, task 2.9): the direct
 * PostGIS coordinates for QGIS → PostGIS, and the OGC endpoints when GeoServer is
 * configured. Read-only config, shown on the «Для ГИС-специалистов» page.
 */
@Injectable()
export class GisAccessService {
  constructor(
    private readonly config: ConfigService,
    private readonly geoserver: GeoServerService,
  ) {}

  getInfo(): GisAccessInfoDto {
    const base = this.config.get('GEOSERVER_URL');
    const workspace = this.geoserver.workspace;
    return {
      postgis: {
        host: this.config.get('GIS_PG_PUBLIC_HOST'),
        port: this.config.get('GIS_PG_PUBLIC_PORT'),
        database: this.config.get('GIS_PG_PUBLIC_DATABASE'),
        schema: 'gis',
      },
      ogc:
        base && workspace
          ? {
              wms: `${base.replace(/\/$/, '')}/${workspace}/wms`,
              wfs: `${base.replace(/\/$/, '')}/${workspace}/wfs`,
              workspace,
            }
          : null,
    };
  }
}
