// fix-links.js — 首次启动时重建 pnpm node_modules 的 junction
// zip 解压后 junction 会断裂，此脚本在 start.bat 中自动运行修复
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);

function resolveInsideRoot(value) {
  const resolved = path.resolve(value);
  const relative = path.relative(ROOT, resolved);
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new Error(`Path escapes package root: ${value}`);
  }
  return resolved;
}

function mkJunction(link, target) {
  let linkPath;
  let targetPath;
  try {
    linkPath = resolveInsideRoot(link);
    targetPath = resolveInsideRoot(target);
  } catch {
    return;
  }
  try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch {}
  try {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(targetPath, linkPath, 'junction');
  } catch {}
}

function fixPnpmHoisting(nmDir) {
  const pnpmDir = path.join(nmDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) return;

  // 1. Hoist ALL packages from .pnpm/<pkg>@*/node_modules/<pkg> to top-level
  // This ensures Node.js can resolve any transitive dependency from anywhere
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (entry === 'node_modules' || entry === '.modules.yaml') continue;
    const pkgNmDir = path.join(pnpmDir, entry, 'node_modules');
    if (!fs.existsSync(pkgNmDir)) continue;
    for (const dep of fs.readdirSync(pkgNmDir)) {
      if (dep === '.bin' || dep === '.cache' || dep === '.pnpm') continue;
      const depPath = path.join(pkgNmDir, dep);
      try { if (!fs.statSync(depPath).isDirectory()) continue; } catch { continue; }
      if (dep.startsWith('@')) {
        for (const child of fs.readdirSync(depPath)) {
          const topTarget = path.join(nmDir, dep, child);
          if (!fs.existsSync(topTarget)) {
            fs.mkdirSync(path.join(nmDir, dep), { recursive: true });
            mkJunction(topTarget, path.join(depPath, child));
          }
        }
      } else if (dep.startsWith('.')) {
        // .prisma etc
        const topTarget = path.join(nmDir, dep);
        if (!fs.existsSync(topTarget)) mkJunction(topTarget, depPath);
      } else {
        const topTarget = path.join(nmDir, dep);
        if (!fs.existsSync(topTarget)) mkJunction(topTarget, depPath);
      }
    }
  }

  // 2. Also hoist from .pnpm/node_modules/ (pnpm deploy structure)
  const pnpmNm = path.join(pnpmDir, 'node_modules');
  if (fs.existsSync(pnpmNm)) {
    for (const entry of fs.readdirSync(pnpmNm)) {
      if (entry === '.bin' || entry === '.cache') continue;
      const src = path.join(pnpmNm, entry);
      try { if (!fs.statSync(src).isDirectory()) continue; } catch { continue; }
      if (entry.startsWith('@')) {
        for (const child of fs.readdirSync(src)) {
          const target = path.join(nmDir, entry, child);
          if (!fs.existsSync(target)) {
            fs.mkdirSync(path.join(nmDir, entry), { recursive: true });
            mkJunction(target, path.join(src, child));
          }
        }
      } else {
        const target = path.join(nmDir, entry);
        if (!fs.existsSync(target)) mkJunction(target, src);
      }
    }
  }

  // 3. Key packages: convert real dirs to junctions for proper resolution
  const topPkgs = ['next', 'react', 'react-dom', 'sharp'];
  for (const pkg of topPkgs) {
    const topDir = path.join(nmDir, pkg);
    const pattern = pkg === 'next' ? /^next@.*_react/ : new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`);
    const match = fs.readdirSync(pnpmDir).find(d => pattern.test(d));
    if (!match) continue;
    const realPath = path.join(pnpmDir, match, 'node_modules', pkg);
    if (!fs.existsSync(realPath)) continue;
    if (!fs.existsSync(topDir)) {
      mkJunction(topDir, realPath);
    } else {
      try {
        const stat = fs.lstatSync(topDir);
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
          mkJunction(topDir, realPath);
        }
      } catch {}
    }
  }

  // 4. Rebuild internal .pnpm cross-references (pnpm's dep resolution within .pnpm)
  // Each .pnpm/<pkg>@*/node_modules/<dep> should point to .pnpm/<dep>@*/node_modules/<dep>
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (entry === 'node_modules' || entry === '.modules.yaml') continue;
    const pkgNmDir = path.join(pnpmDir, entry, 'node_modules');
    if (!fs.existsSync(pkgNmDir)) continue;
    for (const dep of fs.readdirSync(pkgNmDir)) {
      if (dep === '.bin' || dep.startsWith('.')) continue;
      const depPath = path.join(pkgNmDir, dep);
      try {
        const stat = fs.lstatSync(depPath);
        // If it's a broken symlink or empty dir (from zip), recreate
        if (stat.isSymbolicLink() || (stat.isDirectory() && fs.readdirSync(depPath).length === 0)) {
          // Find the real package in .pnpm
          const depName = dep.startsWith('@') ? dep : dep;
          const depPattern = dep.startsWith('@')
            ? new RegExp(`^${dep.replace('/', '\\+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`)
            : new RegExp(`^${dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`);
          const depMatch = fs.readdirSync(pnpmDir).find(d => depPattern.test(d));
          if (depMatch) {
            const realDep = path.join(pnpmDir, depMatch, 'node_modules', dep);
            if (fs.existsSync(realDep) && realDep !== depPath) {
              mkJunction(depPath, realDep);
            }
          }
        }
      } catch {}
    }
  }
}

// Fix server
const serverNm = path.join(ROOT, 'apps', 'server', 'node_modules');
if (fs.existsSync(serverNm)) fixPnpmHoisting(serverNm);

// Fix web
const webNm = path.join(ROOT, 'apps', 'web', 'node_modules');
if (fs.existsSync(webNm)) fixPnpmHoisting(webNm);
