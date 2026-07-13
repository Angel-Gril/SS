import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const layout = fs.readFileSync('apps/web/src/app/(dashboard)/layout.tsx', 'utf8');
const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');

test('dashboard navigation becomes a dismissible overlay without shrinking mobile content', () => {
  assert.match(layout, /mobileNavigationOpen/);
  assert.match(layout, /mobileOpen=\{mobileNavigationOpen\}/);
  assert.match(layout, /aria-label="关闭导航菜单"/);
  assert.match(layout, /fixed inset-0 z-40[^"']*md:hidden/);

  assert.match(sidebar, /mobileOpen: boolean/);
  assert.match(sidebar, /onMobileClose: \(\) => void/);
  assert.match(
    sidebar,
    /fixed inset-y-0 left-0 z-50[^"']*md:sticky[^"']*md:translate-x-0/,
  );
  assert.match(sidebar, /mobileOpen \? 'translate-x-0' : '-translate-x-full'/);
});

test('an opened mobile drawer renders full labels and closes after navigation', () => {
  assert.match(sidebar, /!mobileOpen/);
  assert.match(sidebar, /onClick=\{onMobileClose\}/);
});
