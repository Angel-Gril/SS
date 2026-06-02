/**
 * Bootstrap：在加载 dotenv 之后、模块业务代码之前，
 * 把外置 config.json 的端口/JWT/DB 配置注入到 process.env，
 * 让生产打包版可以用相邻的 config.json 而非 .env 跑起来。
 *
 * 查找顺序：
 *   1. process.env.SS_ERP_CONFIG （绝对路径，启动器可以指定）
 *   2. <进程当前工作目录>/config.json
 *   3. <可执行文件所在目录上溯一级>/config.json （处理 portable 包结构）
 *
 * config.json 格式示例：
 * {
 *   "serverPort": 3401,
 *   "webPort": 3400,
 *   "databaseUrl": "postgresql://...",
 *   "jwtSecret": "xxx",
 *   "encryptionKey": "xxx",
 *   "corsOrigin": "http://localhost:3400"
 * }
 *
 * 缺失字段不报错，回退到 .env / 默认值。
 * jwtSecret 缺失时不在这里生成（启动器脚本负责生成并写盘）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveConfigPath(configPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(dirname(configPath), value);
}

function assertLocalUploadDirSafe(configPath: string, uploadDir: string): void {
  const dataRoot = resolve(dirname(configPath), 'data');
  const normalizedDataRoot = dataRoot.replace(/[\\/]+$/, '');
  const normalizedUploadDir = resolve(uploadDir).replace(/[\\/]+$/, '');
  const separator = process.platform === 'win32' ? '\\' : '/';
  const comparableDataRoot = process.platform === 'win32' ? normalizedDataRoot.toLowerCase() : normalizedDataRoot;
  const comparableUploadDir = process.platform === 'win32' ? normalizedUploadDir.toLowerCase() : normalizedUploadDir;
  const dataPrefix = `${comparableDataRoot}${separator}`;
  if (comparableUploadDir === comparableDataRoot || !comparableUploadDir.startsWith(dataPrefix)) {
    throw new Error(`local uploadDir must be a child directory under ${dataRoot}`);
  }
}

function loadExternalConfig(): void {
  const candidates: string[] = [];
  if (process.env.SS_ERP_CONFIG) candidates.push(process.env.SS_ERP_CONFIG);
  candidates.push(resolve(process.cwd(), 'config.json'));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, '../../config.json'));
    candidates.push(resolve(here, '../config.json'));
  } catch {
    // ignore
  }

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(path, 'utf-8'));
      // config.json 强制覆盖环境变量 — 便携包中它是唯一配置源
      if (cfg.serverPort) process.env.SERVER_PORT = String(cfg.serverPort);
      if (cfg.serverHost) process.env.SERVER_HOST = String(cfg.serverHost);
      if (cfg.databaseUrl) process.env.DATABASE_URL = String(cfg.databaseUrl);
      if (cfg.jwtSecret) process.env.JWT_SECRET = String(cfg.jwtSecret);
      if (cfg.encryptionKey || cfg.encryption_key) process.env.ENCRYPTION_KEY = String(cfg.encryptionKey || cfg.encryption_key);
      if (cfg.corsOrigin) process.env.CORS_ORIGIN = String(cfg.corsOrigin);
      if (cfg.redisUrl) process.env.REDIS_URL = String(cfg.redisUrl);
      if (cfg.redisDisabled !== undefined) process.env.REDIS_DISABLED = String(cfg.redisDisabled);
      if (cfg.uploadDir) {
        const uploadDir = resolveConfigPath(path, String(cfg.uploadDir));
        const runtimeMode = String(cfg.runtimeMode || process.env.RUNTIME_MODE || '').toLowerCase();
        if (runtimeMode === 'local') {
          assertLocalUploadDirSafe(path, uploadDir);
        }
        process.env.UPLOAD_DIR = uploadDir;
      }
      if (cfg.httpsProxy) process.env.HTTPS_PROXY = String(cfg.httpsProxy);
      console.log(`[bootstrap] loaded external config from ${path}`);
      return;
    } catch (e) {
      console.warn(`[bootstrap] failed to parse ${path}:`, (e as Error).message);
    }
  }
}

loadExternalConfig();

// 生产环境关键密钥硬校验 — 缺失或使用默认值时直接拒绝启动
if (process.env.NODE_ENV === 'production') {
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret === 'dev-secret-change-me' || jwtSecret.length < 16) {
    console.error('[FATAL] JWT_SECRET 未配置或长度不足 16 字符，拒绝启动');
    process.exit(1);
  }

  const encKey = process.env.ENCRYPTION_KEY || '';
  if (!encKey || encKey === '32-byte-base64-key-for-encrypting-shop-credentials' || encKey.length < 32) {
    console.error('[FATAL] ENCRYPTION_KEY 未配置或长度不足 32 字符，拒绝启动');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL 未配置，拒绝启动');
    process.exit(1);
  }

  const redisDisabled = process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true';
  if (!redisDisabled && !process.env.REDIS_URL) {
    console.error('[FATAL] REDIS_URL 未配置且 REDIS_DISABLED 未开启，拒绝启动');
    process.exit(1);
  }

  if (!process.env.CORS_ORIGIN) {
    console.error('[FATAL] CORS_ORIGIN 未配置，拒绝启动');
    process.exit(1);
  }
}
