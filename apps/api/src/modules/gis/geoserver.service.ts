import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { AppException } from '../../common/exceptions/app.exception';

/** The PostGIS datastore the workspace publishes from — always the `gis` schema. */
const DATASTORE = 'gis';
const GEOMETRY_SRID = 4326;

/** GeoServer connection, resolved from config once. `null` when unconfigured. */
interface GeoServerConfig {
  baseUrl: string;
  auth: string;
  workspace: string;
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
}

/**
 * GeoServer REST publication (docs/modules/10 §7, task 2.9). A registry layer whose
 * physical table lives in schema `gis` is published to the `cuks` workspace as a
 * WMS/WFS feature type; QGIS and ArcGIS consume it at `…/geoserver/cuks/{wms|wfs}`.
 *
 * Everything is idempotent and best-effort in the sense that it never blocks the
 * platform: when GeoServer is not configured (`GEOSERVER_URL` unset) the service
 * reports so and the map keeps working — publication is an optional integration,
 * not a hard dependency (docs/02 ADR-7: Martin serves the web, GeoServer serves OGC).
 */
@Injectable()
export class GeoServerService {
  private readonly logger = new Logger(GeoServerService.name);
  private readonly config: GeoServerConfig | null;

  constructor(config: ConfigService) {
    const baseUrl = config.get('GEOSERVER_URL');
    const password = config.get('GEOSERVER_ADMIN_PASSWORD');
    if (!baseUrl || !password) {
      this.config = null;
      return;
    }
    const user = config.get('GEOSERVER_ADMIN_USER');
    this.config = {
      baseUrl: baseUrl.replace(/\/$/, ''),
      auth: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
      workspace: config.get('GEOSERVER_WORKSPACE'),
      pgHost: config.get('GEOSERVER_PG_HOST'),
      pgPort: config.get('GEOSERVER_PG_PORT'),
      pgDatabase: config.get('GIS_PG_PUBLIC_DATABASE'),
      pgUser: config.get('GEOSERVER_PG_USER'),
      pgPassword: config.get('GEOSERVER_PG_PASSWORD'),
    };
  }

  get configured(): boolean {
    return this.config !== null;
  }

  get workspace(): string | null {
    return this.config?.workspace ?? null;
  }

  /**
   * Publish `tableName` as a feature type and return the GeoServer layer name
   * (`workspace:tableName`). Ensures the workspace and PostGIS datastore exist
   * first — all three calls tolerate "already there".
   */
  async publish(tableName: string): Promise<string> {
    const config = this.requireConfig();
    await this.ensureWorkspace(config);
    await this.ensureDatastore(config);
    await this.ensureFeatureType(config, tableName);
    return `${config.workspace}:${tableName}`;
  }

  /** Remove the feature type (and its implicit layer). Missing = already gone. */
  async unpublish(tableName: string): Promise<void> {
    const config = this.requireConfig();
    const res = await this.fetch(
      config,
      `/rest/workspaces/${config.workspace}/datastores/${DATASTORE}/featuretypes/${tableName}?recurse=true`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      throw await this.error('unpublish', res);
    }
  }

  private requireConfig(): GeoServerConfig {
    if (!this.config) {
      throw AppException.badRequest(
        'gis.geoserver.not_configured',
        'GeoServer is not configured on this server',
      );
    }
    return this.config;
  }

  private async ensureWorkspace(config: GeoServerConfig): Promise<void> {
    const exists = await this.fetch(config, `/rest/workspaces/${config.workspace}`, {
      method: 'GET',
    });
    if (exists.ok) return;
    const res = await this.fetch(config, '/rest/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: { name: config.workspace } }),
    });
    if (!res.ok) throw await this.error('create workspace', res);
  }

  private async ensureDatastore(config: GeoServerConfig): Promise<void> {
    const path = `/rest/workspaces/${config.workspace}/datastores/${DATASTORE}`;
    const exists = await this.fetch(config, path, { method: 'GET' });
    if (exists.ok) return;

    const body = {
      dataStore: {
        name: DATASTORE,
        connectionParameters: {
          entry: [
            { '@key': 'dbtype', $: 'postgis' },
            { '@key': 'host', $: config.pgHost },
            { '@key': 'port', $: String(config.pgPort) },
            { '@key': 'database', $: config.pgDatabase },
            { '@key': 'schema', $: DATASTORE },
            // The user GeoServer connects as — a gis_reader-scoped role in
            // production (docs/09 §Права PG), the platform user in dev.
            { '@key': 'user', $: config.pgUser },
            { '@key': 'passwd', $: config.pgPassword },
            { '@key': 'Expose primary keys', $: 'true' },
          ],
        },
      },
    };
    const res = await this.fetch(config, `/rest/workspaces/${config.workspace}/datastores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.error('create datastore', res);
  }

  private async ensureFeatureType(config: GeoServerConfig, tableName: string): Promise<void> {
    const base = `/rest/workspaces/${config.workspace}/datastores/${DATASTORE}/featuretypes`;
    const exists = await this.fetch(config, `${base}/${tableName}`, { method: 'GET' });
    if (exists.ok) return;

    const body = {
      featureType: {
        name: tableName,
        nativeName: tableName,
        srs: `EPSG:${GEOMETRY_SRID}`,
        // Trust the geometry SRID rather than re-projecting; everything is 4326.
        projectionPolicy: 'FORCE_DECLARED',
        enabled: true,
      },
    };
    const res = await this.fetch(config, base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.error('publish feature type', res);
  }

  private fetch(config: GeoServerConfig, path: string, init: RequestInit): Promise<Response> {
    return fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', authorization: config.auth, ...(init.headers ?? {}) },
      // GeoServer can be slow to answer under load; fail fast rather than hang a request.
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async error(action: string, res: Response): Promise<AppException> {
    const detail = await res.text().catch(() => '');
    this.logger.error(`GeoServer ${action} failed: ${res.status} ${detail.slice(0, 200)}`);
    return AppException.badRequest(
      'gis.geoserver.request_failed',
      `GeoServer ${action} failed (${res.status})`,
    );
  }
}
