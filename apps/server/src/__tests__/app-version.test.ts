import { describe, it, expect } from 'vitest';
import { compareVersions, getLatestVersion } from '../routes/app-version.js';

describe('AppVersion - compareVersions', () => {
  it('should return 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
  });

  it('should return 1 when first is greater', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  });

  it('should return -1 when first is lesser', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });

  it('should handle missing patch versions', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });
});

describe('AppVersion - getLatestVersion', () => {
  it('should select the greatest semver instead of relying on input order', () => {
    const latest = getLatestVersion([
      { version: '1.10.0', label: 'newer' },
      { version: '1.2.9', label: 'older' },
      { version: '1.9.9', label: 'middle' },
    ]);

    expect(latest?.label).toBe('newer');
  });

  it('should return null when there are no active versions', () => {
    expect(getLatestVersion([])).toBeNull();
  });
});
