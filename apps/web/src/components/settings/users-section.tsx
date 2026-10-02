'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, UserRole } from '@dockora/shared';
import { MIN_PASSWORD_LENGTH } from '@dockora/shared';
import {
  createAuthUser,
  deleteAuthUser,
  fetchAuthUsers,
  updateAuthUser,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { Button, Input, Label, Select } from '@/components/ui/form-controls';
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
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await fetchAuthUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setReady(true);
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

  const openEdit = (u: AuthUser) => {
    setEditing(u);
    setEditDisplayName(u.displayName ?? '');
    setEditPassword('');
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const patch: { displayName?: string | null; password?: string } = {
        displayName: editDisplayName.trim() || null,
      };
      if (editPassword.trim().length >= MIN_PASSWORD_LENGTH) {
        patch.password = editPassword.trim();
      } else if (editPassword.trim().length > 0) {
        setError(t.settings.users.passwordTooShort);
        setBusy(false);
        return;
      }
      await updateAuthUser(editing.id, patch);
      setEditing(null);
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
              {u.totpEnabled ? (
                <p className="text-[11px] text-dockora-muted">{t.settings.users.totpOn}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Select
                aria-label={`${t.settings.users.role} ${u.email}`}
                value={u.role}
                disabled={busy || me?.id === u.id}
                onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
                className="w-auto"
              >
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </Select>
              <Button disabled={busy} onClick={() => openEdit(u)}>
                {t.settings.users.edit}
              </Button>
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
        {ready && !error && users.length === 0 ? (
          <li className="px-4 py-3 text-sm text-dockora-muted">{t.settings.users.empty}</li>
        ) : null}
      </ul>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="dockora-field-group grid gap-3 sm:grid-cols-2"
      >
        <div>
          <Label htmlFor="user-email">{t.settings.users.email}</Label>
          <Input
            id="user-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="user-password">{t.settings.users.password}</Label>
          <Input
            id="user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
        <div>
          <Label htmlFor="user-display-name">{t.settings.users.displayName}</Label>
          <Input
            id="user-display-name"
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="user-role">{t.settings.users.role}</Label>
          <Select
            id="user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full"
          >
            <option value="admin">admin</option>
            <option value="operator">operator</option>
            <option value="viewer">viewer</option>
          </Select>
        </div>
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

      <ConfirmDialog
        open={Boolean(editing)}
        title={t.settings.users.editTitle}
        description={editing?.email}
        confirmLabel={t.common.save}
        cancelLabel={t.common.cancel}
        busy={busy}
        onCancel={() => setEditing(null)}
        onConfirm={() => void handleEditSave()}
      >
        <div className="space-y-3 pt-2">
          <div>
            <Label htmlFor="user-edit-name">{t.settings.users.displayName}</Label>
            <Input
              id="user-edit-name"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="user-edit-password">{t.settings.users.newPasswordOptional}</Label>
            <Input
              id="user-edit-password"
              type="password"
              autoComplete="new-password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
        </div>
      </ConfirmDialog>
    </Section>
  );
}
