import { describe, expect, it } from 'vitest';
import { milliCToCelsius, parseSnapTemperature, pickCpuTemperature } from './cpu-temperature.js';

describe('milliCToCelsius', () => {
  it('converts millidegrees and rejects junk', () => {
    expect(milliCToCelsius('45000')).toBe(45);
    expect(milliCToCelsius('45')).toBe(45);
    expect(milliCToCelsius('0')).toBeNull();
    expect(milliCToCelsius('200000')).toBeNull();
  });
});

describe('pickCpuTemperature', () => {
  it('prefers package/CPU sensors over ACPI', () => {
    expect(
      pickCpuTemperature([
        { source: 'acpitz', celsius: 28 },
        { source: 'x86_pkg_temp', celsius: 61.2 },
        { source: 'coretemp', celsius: 58 },
      ]),
    ).toBe(61.2);
  });

  it('ignores ACPI-only readings', () => {
    expect(pickCpuTemperature([{ source: 'acpitz', celsius: 27 }])).toBeNull();
  });
});

describe('parseSnapTemperature', () => {
  it('reads millidegrees from the host-agent snap', () => {
    expect(parseSnapTemperature('47200\n')).toBe(47.2);
    expect(parseSnapTemperature('')).toBeNull();
  });
});
