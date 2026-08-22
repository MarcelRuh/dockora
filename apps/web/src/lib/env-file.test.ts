import { describe, expect, it } from 'vitest';
import { isSecretEnvKey, parseEnvFile, serializeEnvFile } from './env-file';

describe('parseEnvFile / serializeEnvFile', () => {
  it('round-trips keys, comments and blanks', () => {
    const raw = 'PUID=1000\n# comment\nPASSWORD=s3cret\n\nTZ=Europe/Berlin\n';
    const parsed = parseEnvFile(raw);
    expect(parsed).toEqual([
      { kind: 'pair', key: 'PUID', value: '1000' },
      { kind: 'other', raw: '# comment' },
      { kind: 'pair', key: 'PASSWORD', value: 's3cret' },
      { kind: 'other', raw: '' },
      { kind: 'pair', key: 'TZ', value: 'Europe/Berlin' },
    ]);
    expect(serializeEnvFile(parsed)).toBe(raw);
  });
});

describe('isSecretEnvKey', () => {
  it('detects password-like keys', () => {
    expect(isSecretEnvKey('BOOTSTRAP_ADMIN_PASSWORD')).toBe(true);
    expect(isSecretEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isSecretEnvKey('PUID')).toBe(false);
  });
});
