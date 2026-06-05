import { describe, expect, it } from 'vitest';
import {
  SystemConfigMeta,
  SystemConfigSchema,
  coerceConfigValue,
  getDefaultValue,
} from '../config/system-config-schema.js';

describe('system config backup schema', () => {
  it('supports Alibaba Cloud RDS as a managed database backup provider', () => {
    expect(SystemConfigSchema.backup_database_provider.parse('aliyun-rds')).toBe('aliyun-rds');
    expect(SystemConfigMeta.backup_database_provider.description).toContain('RDS');
  });

  it('keeps Alibaba Cloud RDS snapshot retention at seven days or more', () => {
    expect(SystemConfigSchema.backup_rds_snapshot_keep_days.parse(7)).toBe(7);
    expect(SystemConfigSchema.backup_rds_snapshot_keep_days.safeParse(3).success).toBe(false);
  });

  it('tracks cloud backup recovery targets separately from pg_dump retention', () => {
    expect(getDefaultValue('backup_rpo_hours')).toBe(24);
    expect(getDefaultValue('backup_rto_hours')).toBe(8);
    expect(getDefaultValue('backup_local_keep_days')).toBe(7);
    expect(getDefaultValue('backup_remote_keep_days')).toBe(30);
    expect(coerceConfigValue('backup_rpo_hours', '24')).toBe(24);
  });
});
