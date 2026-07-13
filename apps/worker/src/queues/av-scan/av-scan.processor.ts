import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import type { Job, Queue } from 'bullmq';
import {
  auditLog,
  fileVersions,
  fsNodes,
  notifications,
  roles,
  userRoles,
  type Database,
} from '@cuks/db';
import {
  DANGEROUS_MIME_TYPES,
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  QUEUE,
  type FileVersionJobData,
} from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';
import type { WorkerEnv } from '../../config/env';
import { scanBuffer } from './clamd-client';
import { hasDangerousSvgContent, isShebangScript } from './content-sniff';
import { sniffMime } from './mime-sniff';

/**
 * `av-scan` queue consumer (docs/09 §2, docs/modules/12 §8): ClamAV verdict +
 * magic-byte MIME sniffing (real bytes, not the client-declared Content-Type) for
 * a short list of always-dangerous binary types, plus real-bytes checks for
 * text-based dangerous content that has no binary signature `file-type` can key
 * off (SVG-embedded scripts, shell-script shebangs — content-sniff.ts). None of
 * these gate on the client-declared MIME type: a file lying about its
 * Content-Type gets no free pass. Either check marks the version `infected` —
 * same enforcement path as a real virus verdict, so `FsNodesService.
 * getDownloadUrl` (apps/api) only needs one status to check. On `clean`, chains
 * `preview`/`text-extract` for the mime types they handle — but only if this is
 * still the node's *current* version (a newer upload may have completed while
 * this scan was queued).
 */
@Processor(QUEUE.avScan)
export class AvScanProcessor extends WorkerHost {
  private readonly logger = new Logger(AvScanProcessor.name);
  private readonly clamavHost: string;
  private readonly clamavPort: number;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    config: ConfigService<WorkerEnv, true>,
    @InjectQueue(QUEUE.preview) private readonly previewQueue: Queue<FileVersionJobData>,
    @InjectQueue(QUEUE.textExtract) private readonly textExtractQueue: Queue<FileVersionJobData>,
  ) {
    super();
    this.clamavHost = config.get('CLAMAV_HOST', { infer: true });
    this.clamavPort = config.get('CLAMAV_PORT', { infer: true });
  }

  async process(job: Job<FileVersionJobData>): Promise<void> {
    const { nodeId, versionId, storageKey, mime } = job.data;
    const bytes = await this.storage.getObject(storageKey);

    const sniffedMime = await sniffMime(bytes);
    const dangerousBinary =
      !!sniffedMime && (DANGEROUS_MIME_TYPES as readonly string[]).includes(sniffedMime);
    const dangerousSvg = hasDangerousSvgContent(bytes);
    const dangerousScript = isShebangScript(bytes);

    let infected: boolean;
    let signature: string | undefined;
    if (dangerousBinary || dangerousSvg || dangerousScript) {
      infected = true;
      signature = dangerousBinary
        ? `dangerous-type:${sniffedMime}`
        : dangerousSvg
          ? 'svg-embedded-script'
          : 'shell-script-shebang';
    } else {
      const verdict = await scanBuffer(this.clamavHost, this.clamavPort, bytes);
      infected = verdict.infected;
      signature = verdict.signature;
    }

    await this.db
      .update(fileVersions)
      .set({ avStatus: infected ? 'infected' : 'clean' })
      .where(eq(fileVersions.id, versionId));
    this.logger.log({ nodeId, versionId, infected, signature }, 'av-scan verdict');

    const [node] = await this.db
      .select({ currentVersionId: fsNodes.currentVersionId })
      .from(fsNodes)
      .where(eq(fsNodes.id, nodeId))
      .limit(1);
    const superseded = node?.currentVersionId !== versionId;

    if (infected) {
      // Still notify/audit even if superseded — a security responder should
      // know a malicious upload was attempted regardless of whether it was
      // later replaced — but `superseded` lets notifyInfected say so, since the
      // live/current version this node shows today may be unrelated and clean.
      await this.notifyInfected(nodeId, versionId, signature, superseded);
      return;
    }

    if (superseded) return; // don't process stale bytes for a replaced version

    if (mime.startsWith('image/')) {
      await this.previewQueue.add('generate', job.data);
    }
    if (mime === PDF_MIME_TYPE || mime === DOCX_MIME_TYPE) {
      await this.textExtractQueue.add('extract', job.data);
    }
  }

  private async notifyInfected(
    nodeId: string,
    versionId: string,
    signature: string | undefined,
    superseded: boolean,
  ): Promise<void> {
    const [version] = await this.db
      .select({ uploadedBy: fileVersions.uploadedBy })
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId))
      .limit(1);
    const [node] = await this.db
      .select({ name: fsNodes.name })
      .from(fsNodes)
      .where(eq(fsNodes.id, nodeId))
      .limit(1);
    const superadmins = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.code, 'superadmin')));

    const name = node?.name ?? 'file';
    const suffix = signature ? `: ${signature}` : '';
    const body = superseded
      ? `An earlier, already-replaced version of "${name}" was blocked by the antivirus scan${suffix}. The current version is unaffected.`
      : `"${name}" was blocked by the antivirus scan${suffix}`;

    // In-app only — the worker process has no Socket.IO server to push `notify.new`
    // over (that lives in apps/api), so this surfaces on the recipient's next
    // fetch/poll rather than instantly. Documented gap, not fixed here (1.3).
    const recipients = new Set<string>();
    if (version?.uploadedBy) recipients.add(version.uploadedBy);
    for (const s of superadmins) recipients.add(s.userId);
    if (recipients.size > 0) {
      await this.db.insert(notifications).values(
        [...recipients].map((userId) => ({
          userId,
          type: 'files.file.infected',
          title: superseded ? 'Infected upload attempt (superseded)' : 'Infected file blocked',
          body,
          entityType: 'file',
          entityId: nodeId,
        })),
      );
    }

    await this.db.insert(auditLog).values({
      action: 'files.file.infected',
      actorId: null,
      entityType: 'file',
      entityId: nodeId,
      meta: { versionId, signature, superseded },
    });
  }
}
