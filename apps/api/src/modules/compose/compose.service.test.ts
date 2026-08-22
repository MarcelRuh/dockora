import { describe, expect, it } from 'vitest';
import { ComposeValidationError, assertComposeService } from './compose.service.js';

const YAML = `services:
  sonarr:
    image: sonarr:latest
  prowlarr:
    image: prowlarr:latest
`;

describe('assertComposeService', () => {
  it('allows omitting the service', () => {
    expect(assertComposeService(YAML, undefined)).toBeUndefined();
    expect(assertComposeService(YAML, '  ')).toBeUndefined();
  });

  it('returns a known service name', () => {
    expect(assertComposeService(YAML, 'sonarr')).toBe('sonarr');
  });

  it('rejects unknown or invalid names', () => {
    expect(() => assertComposeService(YAML, 'radarr')).toThrow(ComposeValidationError);
    expect(() => assertComposeService(YAML, '../etc')).toThrow(ComposeValidationError);
  });

  it('rejects down for a single service', () => {
    expect(() => assertComposeService(YAML, 'sonarr', 'down')).toThrow(/down/i);
  });
});
