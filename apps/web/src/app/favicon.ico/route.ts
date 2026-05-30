const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#f97316"/>
  <text x="32" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#fff">SS</text>
</svg>`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(SVG, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
