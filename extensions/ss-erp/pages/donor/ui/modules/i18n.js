export function t(key, substitutions, fallback) {
  let message = fallback || key;
  const values = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
  values.forEach((value, index) => { message = message.replaceAll(`$${index + 1}`, String(value)); });
  return message;
}
