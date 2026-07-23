import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const layout = fs.readFileSync('apps/web/src/app/(dashboard)/layout.tsx', 'utf8');
const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');

test('dashboard shell clips horizontal overflow without breaking sticky navigation', () => {
  assert.match(layout, /relative min-h-screen flex overflow-x-clip bg-background/);
  assert.doesNotMatch(layout, /overflow-x-hidden/);
});

test('dashboard navigation becomes a dismissible overlay without shrinking mobile content', () => {
  assert.match(layout, /mobileNavigationOpen/);
  assert.match(layout, /mobileOpen=\{mobileNavigationOpen\}/);
  assert.match(layout, /aria-label="关闭导航菜单"/);
  assert.match(layout, /fixed inset-0 z-40[^"']*md:hidden/);

  assert.match(sidebar, /mobileOpen: boolean/);
  assert.match(sidebar, /onMobileClose: \(\) => void/);
  assert.match(
    sidebar,
    /fixed inset-y-0 z-50[^"']*md:sticky[^"']*md:left-0/,
  );
  assert.match(sidebar, /mobileOpen \? 'left-0 visible' : '-left-64 invisible md:visible'/);
  assert.match(
    fs.readFileSync('apps/web/src/components/layout/topbar.tsx', 'utf8'),
    /aria-label="切换导航菜单"/,
  );
});

test('an opened mobile drawer renders full labels and closes after navigation', () => {
  assert.match(sidebar, /!mobileOpen/);
  assert.match(sidebar, /onClick=\{onMobileClose\}/);
});
