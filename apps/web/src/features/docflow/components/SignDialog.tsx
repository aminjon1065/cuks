import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  cn,
  toast,
} from '@cuks/ui';
import type { DocumentDetailDto, SignPayloadDto } from '@cuks/shared';
import {
  fetchSignPayload,
  useActivateCertificate,
  useMyCertificates,
  useSignDocument,
} from '../api/queries';
import {
  exportPublicKeySpki,
  getOrCreateDeviceKey,
  getStoredCertificateId,
  setStoredCertificateId,
  signPayload,
} from '../lib/device-keys';

interface DeviceKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/**
 * Sign a document at its active `sign` step (docs/modules/11 §6). On first use on a
 * device it runs the activation wizard (generate a non-extractable key, issue a
 * certificate). The payload (file hash + requisites) is signed in the browser; the
 * password re-confirms the conscious action.
 */
export function SignDialog({
  doc,
  onClose,
}: {
  doc: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const certs = useMyCertificates();
  const activate = useActivateCertificate();
  const sign = useSignDocument(doc.id);

  const [device, setDevice] = useState<DeviceKey | null>(null);
  const [payload, setPayload] = useState<SignPayloadDto | null>(null);
  const [storedCertId, setStoredCertId] = useState<string | null | undefined>(undefined);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [password, setPassword] = useState('');
  const [prepError, setPrepError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const key = await getOrCreateDeviceKey();
        const [p, certId] = await Promise.all([fetchSignPayload(doc.id), getStoredCertificateId()]);
        if (!alive) return;
        setDevice(key);
        setPayload(p);
        setStoredCertId(certId);
      } catch {
        if (alive) setPrepError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc.id]);

  const usableCert =
    storedCertId != null &&
    (certs.data ?? []).some(
      (c) => c.id === storedCertId && !c.revokedAt && new Date(c.notAfter) > new Date(),
    );
  const activationNeeded = certs.isSuccess && storedCertId !== undefined && !usableCert;
  const preparing = !device || !payload || storedCertId === undefined || certs.isPending;
  const busy = activate.isPending || sign.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!device || !payload || !password.trim()) return;
    try {
      // Activate this device on first use (or if its certificate is gone/expired).
      let certificateId = usableCert ? storedCertId! : null;
      if (!certificateId) {
        const publicKeySpki = await exportPublicKeySpki(device.publicKey);
        const cert = await activate.mutateAsync({
          publicKeySpki,
          deviceLabel: deviceLabel.trim() || t('signatures.device.defaultLabel'),
        });
        await setStoredCertificateId(cert.id);
        certificateId = cert.id;
      }
      const signature = await signPayload(device.privateKey, payload.payload);
      await sign.mutateAsync({ certificateId, signature, password });
      toast({ title: t('signatures.signedToast'), tone: 'success' });
      onClose();
    } catch {
      toast({ title: t('signatures.signFailed'), tone: 'danger' });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('signatures.sign.title')}</DialogTitle>
        </DialogHeader>

        {prepError ? (
          <p className="text-[13px] text-danger">{t('signatures.prepError')}</p>
        ) : preparing ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <div className="rounded-sm border border-border bg-surface-2 p-3 text-xs">
              <p className="mb-1 font-medium text-text">{t('signatures.sign.willSign')}</p>
              <dl className="flex flex-col gap-0.5 text-text-muted">
                <Row label={t('signatures.sign.subject')} value={payload!.requisites.subject} />
                <Row
                  label={t('signatures.sign.regNumber')}
                  value={payload!.requisites.regNumber ?? t('documents.unregistered')}
                />
                <Row
                  label={t('signatures.sign.fileHash')}
                  value={`${payload!.fileSha256.slice(0, 16)}…`}
                  mono
                />
              </dl>
            </div>

            {activationNeeded ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="sign-device">{t('signatures.device.label')}</Label>
                <Input
                  id="sign-device"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                  placeholder={t('signatures.device.defaultLabel')}
                />
                <p className="text-xs text-text-muted">{t('signatures.device.activationHint')}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <Label htmlFor="sign-password">{t('signatures.sign.password')}</Label>
              <Input
                id="sign-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !password.trim()}>
                {activationNeeded
                  ? t('signatures.sign.activateAndSign')
                  : t('signatures.sign.action')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={cn('text-right text-text', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
