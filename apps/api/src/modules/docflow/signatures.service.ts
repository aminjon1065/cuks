import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  certificates,
  documentFiles,
  documents,
  fileVersions,
  fsNodes,
  positions,
  signatures,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import {
  buildSignPayload,
  type ActivateCertificateInput,
  type CertificateDto,
  type SignatureDto,
  type SignDocumentInput,
  type SignPayloadDto,
  type VerifyCheckDto,
  type VerifyResultDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { StorageService } from '../../common/storage/storage.service';
import { canViewDocumentBase } from './document-visibility';
import { CaService } from './ca.service';
import { RoutesService } from './routes.service';
import {
  fromBase64,
  importUserPublicKey,
  randomSerial,
  sha256Hex,
  userVerify,
  utf8,
  type CertificateBody,
} from './signature-crypto';

const CERTIFICATE_VALIDITY_MS = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years (docs/09 §4)

interface MainVersion {
  docVersionId: string;
  storageKey: string;
}

/**
 * Digital signatures (docs/09-security.md §4, task 3.5): device-certificate activation
 * against the internal CA, signing a document at its active `sign` route step, and
 * verifying a signature (validity, chain to CA, revocation-at-signing, file hash). The
 * private key never reaches the server — the browser signs; the server only verifies.
 */
@Injectable()
export class SignaturesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly ca: CaService,
    private readonly routes: RoutesService,
  ) {}

  // --- Certificate activation ------------------------------------------------

  async activate(input: ActivateCertificateInput, actor: AuthUser): Promise<CertificateDto> {
    // The public key must be a well-formed P-256 SPKI key or the certificate is useless.
    try {
      await importUserPublicKey(fromBase64(input.publicKeySpki));
    } catch {
      throw AppException.badRequest(
        'docflow.certificate.bad_key',
        'The public key is not a valid P-256 key',
      );
    }
    const position = await this.primaryPosition(actor.id);
    const serial = randomSerial();
    const notBefore = new Date();
    const notAfter = new Date(notBefore.getTime() + CERTIFICATE_VALIDITY_MS);
    const body: CertificateBody = {
      serial,
      userId: actor.id,
      kind: 'device',
      subject: { username: actor.username, fullName: actor.fullName, position },
      publicKeySpki: input.publicKeySpki,
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
    };
    const caSignature = await this.ca.issueCertificate(body);
    const [created] = await this.db
      .insert(certificates)
      .values({
        userId: actor.id,
        serial,
        kind: 'device',
        deviceLabel: input.deviceLabel,
        publicKeySpki: input.publicKeySpki,
        subjectUsername: actor.username,
        subjectFullName: actor.fullName,
        subjectPosition: position,
        caSignature,
        notBefore,
        notAfter,
      })
      .returning({ id: certificates.id });
    if (!created) throw new Error('Certificate insert did not return an id');
    await this.audit.logAndWait({
      action: 'signature.cert_issued',
      actorId: actor.id,
      entityType: 'certificate',
      entityId: created.id,
      meta: { serial, deviceLabel: input.deviceLabel },
    });
    return this.certificateDto(created.id);
  }

  /** The caller's own certificates (for the device manager / sign modal picker). */
  async myCertificates(actor: AuthUser): Promise<CertificateDto[]> {
    const rows = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.userId, actor.id))
      .orderBy(desc(certificates.createdAt));
    return rows.map((r) => this.rowToCertificateDto(r));
  }

  // --- Signing ---------------------------------------------------------------

  /** Build the canonical payload the client must sign for the document's current main
   *  file version. Requires an active `sign` step for the caller (docs/modules/11 §6). */
  async signPayload(documentId: string, actor: AuthUser): Promise<SignPayloadDto> {
    const doc = await this.requireSignableDoc(documentId, actor);
    const main = await this.currentMainVersion(documentId);
    if (!main) {
      throw AppException.conflict('docflow.sign.no_file', 'The document has no main file to sign');
    }
    const fileSha256 = await this.hashVersion(main.storageKey);
    const requisites = this.requisitesOf(doc);
    return {
      payload: buildSignPayload({ fileSha256, ...requisites }),
      fileSha256,
      requisites,
      docVersionId: main.docVersionId,
    };
  }

  async sign(
    documentId: string,
    input: SignDocumentInput,
    actor: AuthUser,
  ): Promise<SignatureDto[]> {
    const doc = await this.requireSignableDoc(documentId, actor);
    const main = await this.currentMainVersion(documentId);
    if (!main) {
      throw AppException.conflict('docflow.sign.no_file', 'The document has no main file to sign');
    }
    // Load the certificate and validate it belongs to the actor, is active and unexpired.
    const cert = await this.requireUsableCertificate(input.certificateId, actor);

    // Re-derive the payload server-side (never trust a client-supplied hash) and verify
    // the signature against the device's certified public key.
    const fileSha256 = await this.hashVersion(main.storageKey);
    const payload = buildSignPayload({ fileSha256, ...this.requisitesOf(doc) });
    const publicKey = await importUserPublicKey(fromBase64(cert.publicKeySpki));
    const ok = await userVerify(publicKey, fromBase64(input.signature), utf8(payload)).catch(
      () => false,
    );
    if (!ok) {
      throw AppException.badRequest(
        'docflow.sign.invalid_signature',
        'The signature does not verify',
      );
    }
    const payloadHash = await sha256Hex(utf8(payload));

    await this.db.transaction(async (tx) => {
      const located = await this.routes.lockActiveSignStep(tx, documentId, actor);
      if (!located) {
        throw AppException.conflict(
          'docflow.sign.no_step',
          'There is no active signing step for you on this document',
        );
      }
      const now = new Date();
      await tx.insert(signatures).values({
        documentId,
        docVersionId: main.docVersionId,
        userId: actor.id,
        certificateId: cert.id,
        routeStepId: located.step.id,
        algorithm: 'ECDSA_P256_SHA256',
        context: 'sign',
        payload,
        payloadHash,
        signature: input.signature,
        signedAt: now,
      });
      await this.routes.applyStepCompletion(
        tx,
        located.route,
        located.step.id,
        'signed',
        null,
        actor.id,
        now,
      );
    });
    await this.audit.logAndWait({
      action: 'docflow.document.signed',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { certificateSerial: cert.serial },
    });
    this.audit.log({
      action: 'signature.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
    });
    return this.forDocument(documentId, actor);
  }

  // --- Read / verify ---------------------------------------------------------

  /** The document's signatures for the card «Подписи» block, each with a live validity
   *  check against the current main file version. */
  async forDocument(documentId: string, actor: AuthUser): Promise<SignatureDto[]> {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc) throw AppException.notFound('docflow.document.not_found', 'Document not found');
    if (!(await this.canViewDocument(documentId, doc, actor))) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    const rows = await this.db
      .select({
        sig: signatures,
        userName: users.shortName,
        serial: certificates.serial,
      })
      .from(signatures)
      .innerJoin(certificates, eq(certificates.id, signatures.certificateId))
      .leftJoin(users, eq(users.id, signatures.userId))
      .where(eq(signatures.documentId, documentId))
      .orderBy(asc(signatures.signedAt));

    const currentHash = await this.currentMainHash(documentId);
    return rows.map(({ sig, userName, serial }) => ({
      id: sig.id,
      userId: sig.userId,
      userName: userName ?? null,
      certificateId: sig.certificateId,
      certificateSerial: serial,
      algorithm: sig.algorithm,
      context: sig.context,
      signedAt: sig.signedAt.toISOString(),
      valid: currentHash !== null && this.payloadFileHash(sig.payload) === currentHash,
    }));
  }

  /** Verify a signature (docs/09-security.md §4). Available to any authenticated user;
   *  document-identifying fields are redacted for a ДСП document the caller cannot see. */
  async verify(signatureId: string, actor: AuthUser): Promise<VerifyResultDto> {
    const [row] = await this.db
      .select({ sig: signatures, cert: certificates })
      .from(signatures)
      .innerJoin(certificates, eq(certificates.id, signatures.certificateId))
      .where(eq(signatures.id, signatureId))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.signature.not_found', 'Signature not found');
    const { sig, cert } = row;

    const body = this.certificateBodyOf(cert);
    const [signatureOk, chainOk, currentHash] = await Promise.all([
      importUserPublicKey(fromBase64(cert.publicKeySpki))
        .then((key) => userVerify(key, fromBase64(sig.signature), utf8(sig.payload)))
        .catch(() => false),
      this.ca.verifyCertificate(body, cert.caSignature),
      this.currentMainHash(sig.documentId),
    ]);
    // Valid at signing time = not revoked, or revoked only after this signature was made.
    const revocationOk = !cert.revokedAt || cert.revokedAt > sig.signedAt;
    const fileHashOk = currentHash !== null && this.payloadFileHash(sig.payload) === currentHash;

    const checks: VerifyCheckDto[] = [
      { key: 'signature', ok: signatureOk },
      { key: 'chain', ok: chainOk },
      { key: 'revocation', ok: revocationOk },
      { key: 'file_hash', ok: fileHashOk },
    ];
    const valid = checks.every((c) => c.ok);

    const [doc] = await this.db
      .select()
      .from(documents)
      .where(eq(documents.id, sig.documentId))
      .limit(1);
    const canSeeDoc = !!doc && (await this.canViewDocument(sig.documentId, doc, actor));
    return {
      signatureId: sig.id,
      valid,
      checks,
      signerName: cert.subjectFullName,
      signerPosition: cert.subjectPosition,
      certificateSerial: cert.serial,
      context: sig.context,
      signedAt: sig.signedAt.toISOString(),
      documentId: sig.documentId,
      documentSubject: canSeeDoc && doc ? doc.subject : '—',
      documentRegNumber: canSeeDoc && doc ? doc.regNumber : null,
    };
  }

  // --- Internals -------------------------------------------------------------

  /** True if the caller may see the document (base visibility, or route/sign step, or
   *  a signature they made). Signers must be able to see what they signed. */
  private async canViewDocument(
    documentId: string,
    doc: typeof documents.$inferSelect,
    actor: AuthUser,
  ): Promise<boolean> {
    if (canViewDocumentBase(doc, actor)) return true;
    const assignments = await this.routes.actorAssignments(actor.id);
    if (await this.routes.isRouteParticipant(documentId, assignments)) return true;
    const [own] = await this.db
      .select({ id: signatures.id })
      .from(signatures)
      .where(and(eq(signatures.documentId, documentId), eq(signatures.userId, actor.id)))
      .limit(1);
    return !!own;
  }

  /** Load the document and ensure the caller may sign it — visible and with an active
   *  sign step (checked authoritatively in the transaction; this is the early gate). */
  private async requireSignableDoc(
    documentId: string,
    actor: AuthUser,
  ): Promise<typeof documents.$inferSelect> {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc || !(await this.canViewDocument(documentId, doc, actor))) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    return doc;
  }

  private async requireUsableCertificate(
    certificateId: string,
    actor: AuthUser,
  ): Promise<typeof certificates.$inferSelect> {
    const [cert] = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, certificateId))
      .limit(1);
    if (!cert || cert.userId !== actor.id) {
      throw AppException.notFound('docflow.certificate.not_found', 'Certificate not found');
    }
    const now = new Date();
    if (cert.revokedAt || cert.notAfter < now || cert.notBefore > now) {
      throw AppException.conflict(
        'docflow.certificate.not_usable',
        'The certificate is revoked or expired',
      );
    }
    return cert;
  }

  private async currentMainVersion(documentId: string): Promise<MainVersion | null> {
    const [row] = await this.db
      .select({ docVersionId: fileVersions.id, storageKey: fileVersions.storageKey })
      .from(documentFiles)
      .innerJoin(fsNodes, eq(fsNodes.id, documentFiles.fileId))
      .innerJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
      .where(
        and(
          eq(documentFiles.documentId, documentId),
          eq(documentFiles.kind, 'main'),
          eq(documentFiles.isCurrent, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async currentMainHash(documentId: string): Promise<string | null> {
    const main = await this.currentMainVersion(documentId);
    return main ? this.hashVersion(main.storageKey) : null;
  }

  private async hashVersion(storageKey: string): Promise<string> {
    const bytes = await this.storage.getObjectBytes(storageKey);
    return sha256Hex(new Uint8Array(bytes));
  }

  private requisitesOf(doc: typeof documents.$inferSelect): {
    regNumber: string | null;
    regDate: string | null;
    subject: string;
  } {
    return {
      regNumber: doc.regNumber,
      regDate: doc.regDate?.toISOString() ?? null,
      subject: doc.subject,
    };
  }

  /** The `fileSha256` embedded in a stored signed payload (for the live file-hash check). */
  private payloadFileHash(payload: string): string | null {
    try {
      const parsed = JSON.parse(payload) as { fileSha256?: unknown };
      return typeof parsed.fileSha256 === 'string' ? parsed.fileSha256 : null;
    } catch {
      return null;
    }
  }

  private certificateBodyOf(cert: typeof certificates.$inferSelect): CertificateBody {
    return {
      serial: cert.serial,
      userId: cert.userId,
      kind: cert.kind,
      subject: {
        username: cert.subjectUsername,
        fullName: cert.subjectFullName,
        position: cert.subjectPosition,
      },
      publicKeySpki: cert.publicKeySpki,
      notBefore: cert.notBefore.toISOString(),
      notAfter: cert.notAfter.toISOString(),
    };
  }

  private async primaryPosition(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: positions.name })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .where(eq(userPositions.userId, userId))
      .limit(1);
    return row?.name ?? null;
  }

  private async certificateDto(id: string): Promise<CertificateDto> {
    const [row] = await this.db.select().from(certificates).where(eq(certificates.id, id)).limit(1);
    if (!row) throw AppException.notFound('docflow.certificate.not_found', 'Certificate not found');
    return this.rowToCertificateDto(row);
  }

  private rowToCertificateDto(row: typeof certificates.$inferSelect): CertificateDto {
    return {
      id: row.id,
      serial: row.serial,
      kind: row.kind,
      deviceLabel: row.deviceLabel,
      subject: {
        username: row.subjectUsername,
        fullName: row.subjectFullName,
        position: row.subjectPosition,
      },
      notBefore: row.notBefore.toISOString(),
      notAfter: row.notAfter.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
