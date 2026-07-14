import { z } from 'zod';
import { GIS_DB_ACCOUNT_KINDS, type GisDbAccountKind } from '../enums/index';

// --- Direct PostGIS access accounts for QGIS/ArcGIS (docs/modules/10 §7; task 2.9) ---

/** A managed PostGIS login role. The password is never stored — it is shown once,
 *  at creation, and cannot be retrieved again (reset = recreate). */
export interface GisDbAccountDto {
  id: string;
  /** The PostgreSQL role name (always `cuks_gis_<label>`). */
  username: string;
  kind: GisDbAccountKind;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** The one-time creation response: the account plus its password (shown once). */
export interface GisDbAccountSecretDto extends GisDbAccountDto {
  /** Generated password — displayed once and never returned again. */
  password: string;
}

export const createGisDbAccountSchema = z.object({
  /** Human label; the role name is `cuks_gis_<slug(label)>` — the label may be
   *  Russian, it is transliterated to an ASCII role name server-side. */
  label: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{L}\p{N} .,_-]+$/u, 'Only letters, digits, spaces and . , - _'),
  kind: z.enum(GIS_DB_ACCOUNT_KINDS),
  note: z.string().trim().max(500).optional(),
});
export type CreateGisDbAccountInput = z.infer<typeof createGisDbAccountSchema>;

// --- GeoServer WMS/WFS publication (docs/modules/10 §7; task 2.9) ---

/** Connection details a GIS specialist needs — filled from server config, shown on
 *  the «Для ГИС-специалистов» page. */
export interface GisAccessInfoDto {
  /** Direct PostGIS connection (QGIS → PostGIS, the primary path). */
  postgis: {
    host: string;
    port: number;
    database: string;
    /** The only schema these accounts can see. */
    schema: string;
  };
  /** OGC endpoints, or null when GeoServer is not configured. */
  ogc: {
    wms: string;
    wfs: string;
    workspace: string;
  } | null;
}
