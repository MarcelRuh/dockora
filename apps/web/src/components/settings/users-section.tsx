'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, UserRole } from '@dockora/shared';
import {
  createAuthUser,
  deleteAuthUser,
  fetchAuthUsers,
  updateAuthUser,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { Button, Input, Select } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner, Section, SuccessBanner } from '@/components/ui/page-parts';

export function UsersSection() {
  const { t } = useLocale();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [pendingDelete, setPendingDelete] = useState<AuthUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await fetchAuthUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [t.common.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await createAuthUser({ email, password, displayName: displayName || undefined, role });
      setEmail('');
      setPassword('');
      setDisplayName('');
      setRole('viewer');
      setSuccess(t.settings.users.created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (id: string, nextRole: UserRole) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await updateAuthUser(id, { role: nextRole });
      setSuccess(t.settings.users.updated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (u: AuthUser) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteAuthUser(u.id);
      setSuccess(t.settings.users.deleted);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.settings.sections.users}>
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <ul className="mb-4 divide-y divide-dockora-border rounded-md border border-dockora-border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="font-medium">{u.displayName || u.email}</p>
              <p className="font-mono text-xs text-dockora-muted">{u.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={u.role}
                disabled={busy || me?.id === u.id}
                onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
                className="w-auto"
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </Select>
              <Button
                variant="danger"
                disabled={busy || me?.id === u.id}
                onClick={() => setPendingDelete(u)}
              >
                {t.common.delete}
              </Button>
            </div>
          </li>
        ))}
        {users.length === 0 ? (
          <li className="px-4 py-3 text-sm text-dockora-muted">{t.settings.users.empty}</li>
        ) : null}
      </ul>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="dockora-field-group grid gap-3 sm:grid-cols-2"
      >
        <Input
          type="email"
          placeholder={t.settings.users.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder={t.settings.users.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <Input
          placeholder={t.settings.users.displayName}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full">
          <option value="admin">admin</option>
          <option value="operator">operator</option>
          <option value="viewer">viewer</option>
        </Select>
        <Button type="submit" variant="primary" disabled={busy} className="sm:col-span-2">
          {t.settings.users.create}
        </Button>
      </form>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t.common.delete}
        description={
          pendingDelete
            ? t.settings.users.deleteConfirm.replace('{email}', pendingDelete.email)
            : undefined
        }
        consequences={[...t.settings.users.deleteConsequences]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const u = pendingDelete;
          setPendingDelete(null);
          if (u) void handleDelete(u);
        }}
      />
    </Section>
  );
}
