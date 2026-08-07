'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAuthStatus, fetchCurrentUser, login as apiLogin } from '@/lib/api';
import { clearAuthToken, getAuthToken, setAuthToken } from '@/lib/auth';
import type { AuthUser } from '@dockora/shared';
import { useLocale } from '@/i18n/locale-provider';
import { Button, Input } from '@/components/ui/form-controls';
import { ErrorBanner } from '@/components/ui/page-parts';
import { NeonAtmosphere, NeonParticles } from '@/components/ui/neon-particles';

type AuthContextValue = {
  authEnabled: boolean;
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiLogin(email, password);
      setAuthToken(res.token);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.invalid);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0">
        <NeonParticles />
        <NeonAtmosphere />
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-6 px-4">
        <div className="space-y-2 text-center">
          <p className="dockora-logo-gradient text-3xl uppercase tracking-[0.14em]">Dockora</p>
          <h1 className="dockora-title-gradient text-2xl">{t.auth.title}</h1>
          <p className="text-sm text-dockora-muted">{t.auth.subtitle}</p>
        </div>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="dockora-panel space-y-4 p-6 shadow-neon"
        >
          <div>
            <label className="mb-1 block text-sm text-dockora-muted">{t.auth.email}</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-dockora-muted">{t.auth.password}</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {t.auth.login}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);

  const loadAuth = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchAuthStatus();
      setAuthEnabled(status.authEnabled);
      if (!status.authEnabled) {
        setUser(null);
        return;
      }
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        return;
      }
      const me = await fetchCurrentUser();
      setUser(me);
    } catch {
      clearAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ authEnabled, user, loading, logout }),
    [authEnabled, user, loading, logout],
  );

  if (!checked || loading) {
    return <p className="p-8 text-sm text-dockora-muted">{t.common.loading}</p>;
  }

  if (authEnabled && !user) {
    return <LoginForm onSuccess={() => void loadAuth()} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return { authEnabled: false, user: null, loading: false, logout: () => {} };
  }
  return ctx;
}

export function AuthLogoutButton() {
  const { authEnabled, user, logout } = useAuth();
  const { t } = useLocale();
  if (!authEnabled || !user) return null;
  return (
    <Button variant="ghost" onClick={logout} className="w-full justify-start text-xs text-inherit">
      {t.auth.logout}
    </Button>
  );
}
