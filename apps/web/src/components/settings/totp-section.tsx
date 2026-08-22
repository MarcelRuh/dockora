'use client';

import { useState } from 'react';
import { confirmTotp, disableTotp, setupTotp } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { Button, Input } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner, Section, SuccessBanner } from '@/components/ui/page-parts';

export function TotpSection() {
  const { t } = useLocale();
  const { user, refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{
    secret: string;
    qrDataUrl: string;
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  if (!user) return null;

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setBackupCodes(null);
    try {
      const res = await setupTotp();
      setSetup({ secret: res.secret, qrDataUrl: res.qrDataUrl });
      setConfirmCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await confirmTotp(confirmCode.trim());
      setBackupCodes(res.backupCodes);
      setSetup(null);
      setSuccess(t.settings.totp.enabledOk);
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const runDisable = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await disableTotp(disablePassword, disableCode.trim() || undefined);
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      setBackupCodes(null);
      setSuccess(t.settings.totp.disabledOk);
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.settings.totp.title}>
      <p className="mb-3 text-sm text-dockora-muted">{t.settings.totp.hint}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <p className="mb-3 text-sm">
        <span className="text-dockora-muted">{t.settings.totp.status}: </span>
        <span className="font-medium">
          {user.totpEnabled ? t.settings.totp.on : t.settings.totp.off}
        </span>
      </p>

      {!user.totpEnabled && !setup ? (
        <Button variant="primary" disabled={busy} onClick={() => void startSetup()}>
          {t.settings.totp.setup}
        </Button>
      ) : null}

      {setup ? (
        <div className="dockora-panel space-y-3 p-4">
          <p className="text-sm text-dockora-muted">{t.settings.totp.scan}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qrDataUrl}
            alt="TOTP QR"
            className="mx-auto h-[220px] w-[220px] rounded bg-white p-2"
          />
          <p className="break-all font-mono text-xs text-dockora-muted">
            {t.settings.totp.manual}: {setup.secret}
          </p>
          <label className="block space-y-1.5 text-sm">
            <span className="text-dockora-muted">{t.auth.totpCode}</span>
            <Input
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy || confirmCode.trim().length < 6}
              onClick={() => void confirmSetup()}
            >
              {t.settings.totp.confirm}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setSetup(null);
                setConfirmCode('');
              }}
            >
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {backupCodes ? (
        <div className="dockora-panel mt-3 space-y-2 border-l-[3px] border-l-dockora-pink p-4">
          <p className="text-sm font-medium">{t.settings.totp.backupTitle}</p>
          <p className="text-xs text-dockora-muted">{t.settings.totp.backupHint}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {user.totpEnabled ? (
        <Button
          variant="danger"
          className="mt-3"
          disabled={busy}
          onClick={() => setDisableOpen(true)}
        >
          {t.settings.totp.disable}
        </Button>
      ) : null}

      <ConfirmDialog
        open={disableOpen}
        title={t.settings.totp.disable}
        description={t.settings.totp.disableConfirm}
        consequences={[...t.settings.totp.disableConsequences]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setDisableOpen(false)}
        onConfirm={() => void runDisable()}
      >
        <div className="space-y-2">
          <Input
            type="password"
            placeholder={t.auth.password}
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            placeholder={t.auth.totpCode}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </div>
      </ConfirmDialog>
    </Section>
  );
}
