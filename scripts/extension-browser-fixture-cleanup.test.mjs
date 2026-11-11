// 浏览器夹具的收尾合同：用例结束后（正常返回或抛错），不遗留浏览器进程，也不遗留临时用户目录。
//
// 背景：夹具启动的 chrome.exe 只是启动器，它拉起真正的浏览器进程后自己以 0 退出，
// 所以只对它调用 kill() 结束不了浏览器；每跑一次就会留下一个无头浏览器（约十个进程）。
// 这里按临时用户目录名精确查找进程，不受同一台机器上其它测试同时运行的影响。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pause, withFixtureBrowser, withLoadedExtensionBrowser } from './extension-browser-fixture.mjs';

// 进程查询用 PowerShell；夹具本身也只认 Windows 下的 Chromium 路径
const options = { skip: process.platform === 'win32' ? false : 'process lookup is Windows-only' };
const FIXTURE_URL = 'https://fixture.invalid/';
const route = async () => ({ body: '<!doctype html><title>fixture</title>', type: 'text/html' });

/** 命令行里带有该用户目录的 chrome.exe 进程号（浏览器主进程及其子进程）。 */
function browserProcesses(profileDir) {
  const filter = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profileDir)}*' }`;
  const output = execFileSync('powershell', ['-NoProfile', '-Command', `${filter} | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
  return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map(Number);
}

async function assertCleanedUp(profileDir, label) {
  let remaining = browserProcesses(profileDir);
  try {
    for (const deadline = Date.now() + 10_000; remaining.length && Date.now() < deadline; remaining = browserProcesses(profileDir)) {
      await pause(500);
    }
    assert.deepEqual(remaining, [], `${label}：浏览器进程应随用例结束而退出`);
    assert.equal(existsSync(profileDir), false, `${label}：临时用户目录应被删除`);
  } finally {
    // 断言失败时也不把浏览器留在机器上
    for (const pid of remaining) {
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已随父进程退出 */ }
    }
  }
}

test('fixture browser exits after a passing run', options, async () => {
  let profileDir;
  await withFixtureBrowser({ route }, async (page) => {
    profileDir = page.profileDir;
    await page.navigate(FIXTURE_URL);
    assert.ok(browserProcesses(profileDir).length > 0, '用例运行期间应能按用户目录查到浏览器进程（否则下面的断言没有意义）');
  });
  await assertCleanedUp(profileDir, '正常结束');
});

test('fixture browser exits after a failing run', options, async () => {
  let profileDir;
  await assert.rejects(withFixtureBrowser({ route }, async (page) => {
    profileDir = page.profileDir;
    throw new Error('simulated assertion failure');
  }), /simulated assertion failure/u);
  await assertCleanedUp(profileDir, '用例抛错');
});

test('loaded-extension browser exits after the run', options, async () => {
  let profileDir;
  await withLoadedExtensionBrowser({ route, interceptPatterns: [FIXTURE_URL + '*'] }, async (page) => {
    profileDir = page.profileDir;
    await page.extensionId();
  });
  await assertCleanedUp(profileDir, '真实扩展形态');
});
