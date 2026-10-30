/**
 * Non-blocking confirmation for the donor workbench.
 *
 * The panel lives in the caller's current work area.  It never falls back to
 * window.confirm: a missing or stale confirmation fails closed.
 */
export function createInlineConfirmation({ container, make = (tag) => document.createElement(tag) }) {
  const panel = make('section');
  panel.className = 'precision-inline-confirmation';
  panel.dataset.inlineConfirmation = 'true';
  panel.hidden = true;
  const message = make('p');
  message.className = 'precision-inline-confirmation-message';
  const details = make('p');
  details.className = 'precision-inline-confirmation-details';
  const state = make('p');
  state.className = 'precision-inline-confirmation-state';
  state.setAttribute('role', 'status');
  const actions = make('div');
  actions.className = 'precision-inline-confirmation-actions';
  const cancel = make('button');
  cancel.type = 'button';
  cancel.className = 'ghost';
  cancel.dataset.inlineConfirm = 'cancel';
  cancel.textContent = '取消';
  const accept = make('button');
  accept.type = 'button';
  accept.className = 'primary';
  accept.dataset.inlineConfirm = 'accept';
  accept.textContent = '确认继续';
  actions.append(cancel, accept);
  panel.append(message, details, state, actions);
  container.append(panel);

  let pending = null, timer = null;
  const settle = value => {
    const current = pending;
    pending = null;
    clearInterval(timer); timer = null;
    panel.hidden = true;
    accept.disabled = false;
    cancel.disabled = false;
    if (current) current.resolve(value);
  };
  const stale = () => {
    settle(false);
    state.textContent = '当前草稿、图片或报价已变化，本次确认已失效。请重新确认当前内容。';
    panel.hidden = false;
    accept.disabled = true;
    cancel.textContent = '关闭';
  };
  const visible = () => {
    if (container.isConnected === false) return false;
    for (let node = container; node; node = node.parentElement) if (node.hidden) return false;
    return true;
  };
  const check = () => {
    if (!pending) return false;
    if (!visible()) { settle(false); return false; }
    try {
      if (pending.getToken && pending.token !== pending.getToken()
        || pending.validate && pending.validate() !== true) { stale(); return false; }
    } catch { stale(); return false; }
    return true;
  };
  const trusted = event => event?.isTrusted === true;
  cancel.addEventListener('click', event => { if (trusted(event)) settle(false); });
  accept.addEventListener('click', event => {
    if (!trusted(event) || !pending) return;
    if (!check()) return;
    settle(true);
  });

  return {
    panel,
    request({ message: text, detail = '', token, getToken, validate } = {}) {
      if (pending) return Promise.resolve(false);
      message.textContent = String(text || '请确认继续当前操作。');
      details.textContent = String(detail || '');
      details.hidden = !detail;
      state.textContent = '请在当前工作区明确选择。';
      panel.hidden = false;
      accept.disabled = false;
      cancel.disabled = false;
      cancel.textContent = '取消';
      panel.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      return new Promise(resolve => {
        pending = { resolve, token, getToken, validate };
        timer = setInterval(check, 250);
        timer.unref?.();
      }).then(accepted => {
        if (!accepted) return false;
        try { return (!getToken || token === getToken()) && (!validate || validate() === true); }
        catch { return false; }
      });
    },
    sync(token) {
      if (pending && pending.token !== undefined && token !== pending.token) stale();
    },
    cancel() { settle(false); },
    check,
    isPending() { return Boolean(pending); },
  };
}
