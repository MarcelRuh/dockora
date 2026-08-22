import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.service.js';

describe('DEFAULT_SETTINGS', () => {
  it('enables auth so fresh installs show the login screen', () => {
    expect(DEFAULT_SETTINGS.authEnabled).toBe(true);
  });
});
