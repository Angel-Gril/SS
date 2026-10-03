// The hosted plan owner projects structured capture keys with the same SHA-256
// alias. This is only a selection hint: the server resolves it against the
// current device/shop/snapshot/SKU authority before using the original key.
export async function compileHostedReferenceSelection(selectedKeys, eligibleMedia) {
  if (!Array.isArray(selectedKeys) || !selectedKeys.length || selectedKeys.length > 5
    || new Set(selectedKeys).size !== selectedKeys.length || !Array.isArray(eligibleMedia)) {
    throw new TypeError('请选择 1 至 5 张当前草稿的参考图');
  }
  const eligible = new Set(eligibleMedia.map(item => item?.key));
  const aliases = [];
  for (const key of selectedKeys) {
    if (typeof key !== 'string' || !key || key.length > 500 || key !== key.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(key) || !eligible.has(key)) {
      throw new TypeError('参考图与当前草稿不一致，请重新选择');
    }
    if (/^media:[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+\|\d+\|https:\/\/[^\s|]+$/u.test(key)) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      aliases.push('media-key-sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    } else {
      if (/(?:https?|ftp|file|blob|data|javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\.|[?#]/iu.test(key)) {
        throw new TypeError('参考素材标识无效，请重新采集');
      }
      aliases.push(key);
    }
  }
  if (new Set(aliases).size !== aliases.length) throw new TypeError('参考素材标识冲突，请重新采集');
  return Object.freeze(aliases);
}
