export interface TrackProvider {
  key: string;
  name: string;
  buildUrl: (trackingNumber: string) => string;
}

export const TRACK_PROVIDERS: TrackProvider[] = [
  {
    key: 'ozon',
    name: 'OZON Track',
    buildUrl: (n) => `https://tracking.ozon.ru/?track=${encodeURIComponent(n)}&local=zh-Hans`,
  },
  {
    key: 'ru17track',
    name: '17TRACK',
    buildUrl: (n) => `https://t.17track.net/zh-cn#nums=${encodeURIComponent(n)}`,
  },
  {
    key: 'cainiao',
    name: '菜鸟国际',
    buildUrl: (n) => `https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(n)}`,
  },
];

export function defaultTrackUrl(trackingNumber: string): string {
  return TRACK_PROVIDERS[0]!.buildUrl(trackingNumber);
}
