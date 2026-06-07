export function splitImageInput(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validImageUrls(images: string[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!isHttpUrl(image) || seen.has(image)) return false;
    seen.add(image);
    return true;
  });
}

export function invalidImageUrls(images: string[]) {
  return images.filter((image) => !isHttpUrl(image));
}
