'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAuthStatus, fetchCurrentUser, login as apiLogin, loginTotp, logout as apiLogout } from '@/lib/api';
import { clearSessionToken } from '@/lib/auth';
import type { AuthUser } from '@dockora/shared';
import { useLocale } from '@/i18n/locale-provider';
import { Button, Input } from '@/components/ui/form-controls';
import { ErrorBanner } from '@/components/ui/page-parts';
import { BrandLogoWide } from '@/components/ui/brand-logo';
import { NeonAtmosphere, NeonParticles } from '@/components/ui/neon-particles';

type AuthContextValue = {
  authEnabled: boolean;
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function LoginForm({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const finishLogin = (user: AuthUser) => {
    onSuccess(user);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiLogin(email, password);
      if (res.requiresTotp && res.tempToken) {
        setTempToken(res.tempToken);
        setTotpCode('');
        return;
      }
      if (!res.user) throw new Error(t.auth.invalid);
      finishLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.invalid);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await loginTotp(tempToken, totpCode.trim());
      if (!res.user) throw new Error(t.auth.invalid);
      finishLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.totpInvalid);
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
          <div className="mx-auto w-48">
            <BrandLogoWide priority />
          </div>
          <h1 className="sr-only">{t.auth.title}</h1>
          <p className="text-sm text-dockora-muted">
            {tempToken ? t.auth.totpSubtitle : t.auth.subtitle}
          </p>
        </div>
        {!tempToken ? (
          <form
            onSubmit={(e) => void handlePasswordSubmit(e)}
            className="dockora-panel space-y-4 p-6 shadow-neon"
          >
            <div>
              <label className="mb-1 block text-sm text-dockora-muted">{t.auth.email}</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-dockora-muted">{t.auth.password}</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error ? <ErrorBanner message={error} /> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {t.auth.login}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void handleTotpSubmit(e)}
            className="dockora-panel space-y-4 p-6 shadow-neon"
          >
            <div>
              <label className="mb-1 block text-sm text-dockora-muted">{t.auth.totpCode}</label>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="123456"
                required
                autoFocus
              />
              <p className="mt-1.5 text-xs text-dockora-muted">{t.auth.totpHint}</p>
            </div>
            {error ? <ErrorBanner message={error} /> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {t.auth.totpVerify}
            </Button>
            <Button
              type="button"
              className="w-full"
              disabled={submitting}
              onClick={() => {
                setTempToken(null);
                setTotpCode('');
                setError(null);
              }}
            >
              {t.common.back}
            </Button>
          </form>
        )}
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
      const me = await fetchCurrentUser();
      setUser(me);
    } catch {
      clearSessionToken();
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
    void apiLogout().finally(() => setUser(null));
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const value = useMemo(
    () => ({ authEnabled, user, loading, logout, refreshUser }),
    [authEnabled, user, loading, logout, refreshUser],
  );

  if (!checked || loading) {
    return <p className="p-8 text-sm text-dockora-muted">{t.common.loading}</p>;
  }

  if (authEnabled && !user) {
    return (
      <LoginForm
        onSuccess={(next) => {
          setAuthEnabled(true);
          setUser(next);
        }}
      />
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      authEnabled: false,
      user: null,
      loading: false,
      logout: () => {},
      refreshUser: async () => {},
    };
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
