import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const globals = readFileSync('apps/web/src/app/globals.css', 'utf8');
const products = readFileSync('apps/web/src/app/(dashboard)/products/page.tsx', 'utf8');
const sidebar = readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const badge = readFileSync('apps/web/src/components/ui/badge.tsx', 'utf8');

assert.match(globals, /--primary:\s*24 80% 52%;/, 'light theme primary should use the softened orange token');
assert.match(globals, /--ring:\s*24 80% 52%;/, 'light theme ring should follow the softened primary token');
assert.match(globals, /--primary:\s*24 80% 56%;/, 'dark theme primary should use the softened orange token');
assert.match(globals, /--ring:\s*24 80% 56%;/, 'dark theme ring should follow the softened primary token');

assert.doesNotMatch(products, /text-blue-600/, 'products page should not use blue for product or price row actions');
assert.match(
  products,
  /className="block truncate text-sm font-medium leading-5 text-foreground hover:text-primary hover:underline"/,
  'Ozon product title link should use foreground text and only accent on hover',
);
assert.match(
  products,
  /<Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:bg-muted hover:text-foreground" onClick=\{\(\) => setDetailProductId\(p\.id\)\}>/,
  'row edit button should be ghost instead of solid primary',
);
assert.match(
  products,
  /className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-muted hover:text-foreground"/,
  'price edit button should use neutral ghost styling',
);
assert.match(
  products,
  /aria-label="按 Ozon 价格指数筛选"/,
  'price column header should be an accessible filter trigger',
);
assert.match(
  products,
  /setPriceFilterMenuOpen\(\(open\) => !open\)/,
  'price column header should toggle the Ozon price filter menu',
);
assert.match(
  products,
  /z-50 mt-2 w-40 .*bg-white .*shadow-xl .*ring-1 .*dark:bg-slate-950/,
  'price filter menu should render as an opaque high-layer panel instead of transparent overlay text',
);
assert.match(
  products,
  /min-w-0 flex-1 truncate/,
  'price filter menu labels should have stable width and truncate cleanly',
);
assert.match(
  products,
  /<TableCell colSpan=\{10\}/,
  'empty product results should keep the table header and render the empty state inside the table body',
);
assert.match(
  products,
  /没有符合当前筛选条件的商品/,
  'filtered empty product results should explain that filters produced no matches',
);

assert.doesNotMatch(sidebar, /border-orange-200/, 'sidebar child rail should use neutral border color');
assert.doesNotMatch(sidebar, /from-orange|to-orange|hover:bg-orange|text-orange/, 'sidebar should not hard-code orange utility colors');
assert.doesNotMatch(sidebar, /from-orange-500 to-orange-600 text-white menu-active/, 'sidebar active items should not be solid orange pills');
assert.doesNotMatch(sidebar, /border-l-2 border-primary/, 'rounded sidebar active items should not use a real left border that creates a half-outline');
assert.doesNotMatch(sidebar, /bg-primary\/10/, 'sidebar active surface should be lighter than bg-primary/10');
assert.doesNotMatch(sidebar, /shadow-\[inset_2px_0_0_hsl/, 'rounded sidebar active items should not use inset shadows that curve around the corner');
assert.match(
  sidebar,
  /bg-primary\/5 text-primary/,
  'sidebar active items should use a lighter primary surface',
);
assert.match(
  sidebar,
  /absolute left-2 top-1\/2 h-4 w-0\.5 -translate-y-1\/2 rounded-full bg-primary\/60/,
  'sidebar active rail should be an independent pill element, not a rounded item border',
);
assert.match(sidebar, /border-border/, 'sidebar child rail should use the semantic border token');

assert.match(badge, /success:\s*'border-transparent bg-emerald-50 text-emerald-700/, 'success badge should use a lighter semantic surface');
assert.match(badge, /warning:\s*'border-transparent bg-amber-50 text-amber-700/, 'warning badge should use a lighter semantic surface');
assert.doesNotMatch(badge, /bg-amber-100/, 'warning badge should no longer use the heavier amber-100 background');

console.log('PASS web products UI polish');
