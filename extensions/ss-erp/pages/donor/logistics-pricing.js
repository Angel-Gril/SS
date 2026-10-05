export function createLogisticsPricing({
  root,
  command,
  getBinding,
  getRows,
  getParameters,
  calculate,
  onQuote,
  onBusyChanged,
  report,
}) {
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const modal = make('div', 'settings-modal');
  modal.id = 'precision-logistics-modal';
  modal.hidden = true;
  const dialog = make('div', 'settings-dialog precision-logistics-dialog'),
    head = make('div', 'settings-head');
  head.append(make('div', 'settings-title', '按店铺物流规则定价'));
  const close = make('button', 'ghost', '关闭');
  close.id = 'precision-logistics-close';
  close.addEventListener('click', () => {
    closeModal();
  });
  head.append(close);
  const body = make('div', 'settings-body'),
    note = make(
      'p',
      '',
      '选择当前店铺的仓库与起讫地，再选择已发布物流方式。按已保存的实测包装计算运费，并核对售价价档。',
    );
  const scope = make('select'),
    service = make('select'),
    battery = make('select');
  scope.id = 'precision-logistics-scope';
  service.id = 'precision-logistics-service';
  battery.id = 'precision-logistics-battery';
  const fields = [
    ['仓库与起讫地', scope],
    ['物流方式', service],
    ['商品电池状态', battery],
  ];
  for (const [label, input] of fields) {
    const field = make('label', 'field', label);
    field.append(input);
    body.append(field);
  }
  for (const [value, label] of [
    ['', '请选择'],
    ['no', '不含电池'],
    ['yes', '含电池'],
  ]) {
    const option = make('option', '', label);
    option.value = value;
    battery.append(option);
  }
  const state = make('p');
  state.id = 'precision-logistics-state';
  state.setAttribute('role', 'status');
  const result = make('div');
  result.id = 'precision-logistics-result';
  const read = make('button', 'ghost', '读取物流方式'),
    quote = make('button', 'primary', '计算并应用运费');
  read.id = 'precision-logistics-read';
  quote.id = 'precision-logistics-quote';
  const foot = make('div', 'settings-foot');
  foot.append(read, quote);
  body.prepend(note);
  body.append(result, state);
  dialog.append(head, body, foot);
  modal.append(dialog);
  root.append(modal);
  let token = '',
    assignments = [],
    release = null,
    busy = false,
    epoch = 0,
    notifiedBusy = false,
    notifying = false;
  const context = () => JSON.stringify(getBinding());
  const sync = () => {
    const stale = modal.hidden || context() !== token;
    read.disabled = busy || stale || !scope.value;
    quote.disabled = busy || stale || !release || !service.value || !battery.value;
    scope.disabled = busy || stale;
    service.disabled = busy || stale || !release;
    battery.disabled = busy || stale;
    if (!notifying && notifiedBusy !== busy && typeof onBusyChanged === 'function') {
      notifiedBusy = busy;
      notifying = true;
      try { onBusyChanged(busy); } finally { notifying = false; }
    }
  };
  function supersede() {
    epoch += 1;
    busy = false;
    result.replaceChildren();
  }
  function closeModal() {
    supersede();
    modal.hidden = true;
    sync();
  }
  scope.addEventListener('change', () => {
    supersede();
    release = null;
    service.replaceChildren();
    sync();
  });
  for (const input of [service, battery]) input.addEventListener('change', () => { supersede(); sync(); });
  const chosen = () => {
    const index = Number(scope.value);
    if (!scope.value || !Number.isSafeInteger(index) || index < 0 || !assignments[index]) throw Error('请明确选择当前店铺的物流路线');
    const item = assignments[index];
    return Object.fromEntries(
      [
        'assignmentId',
        'companyId',
        'warehouseId',
        'originCountryUid',
        'originCityUid',
        'destinationCountryUid',
        'destinationLocationUid',
      ].map((key) => [key, item[key]]),
    );
  };
  read.addEventListener('click', (event) => {
    if (!event.isTrusted || read.disabled) return;
    const run = ++epoch;
    const selectedScope = scope.value;
    const binding = JSON.parse(JSON.stringify(getBinding()));
    const selection = chosen();
    const current = () => run === epoch && !modal.hidden && token === context() && selectedScope === scope.value;
    busy = true;
    sync();
    void Promise.resolve()
      .then(async () => {
        if (!current()) throw Error('草稿或物流路线已变化，请重新读取');
        const response = await command('LOGISTICS_SERVICES', {
          binding,
          listingWorkflowId: binding.listingWorkflowId,
          selection,
        });
        if (!current()) throw Error('草稿或物流路线已变化，请重新读取');
        release = response.data?.logistics;
        service.replaceChildren();
        const empty = make('option', '', '请选择物流方式');
        empty.value = '';
        service.append(empty);
        for (const item of release.services) {
          const option = make('option', '', item.displayName + ' · ' + item.deliveryPromise);
          option.value = item.stableServiceKey;
          service.append(option);
        }
        state.textContent = release.services.length
          ? '选择物流方式并明确电池状态。'
          : '该路线没有已发布可用物流方式。';
      })
      .catch((error) => {
        if (run !== epoch || modal.hidden) return;
        state.textContent = error.message;
        report(error);
      })
      .finally(() => {
        if (run !== epoch) return;
        busy = false;
        sync();
      });
  });
  quote.addEventListener('click', (event) => {
    if (!event.isTrusted || quote.disabled) return;
    const run = ++epoch;
    const binding = JSON.parse(JSON.stringify(getBinding()));
    const selection = chosen();
    const stableServiceKey = service.value;
    const hasBattery = battery.value === 'yes';
    const selectedRelease = { releaseId: release.releaseId, effectiveChecksum: release.effectiveChecksum };
    const rows = JSON.parse(JSON.stringify(getRows()));
    const parameters = JSON.parse(JSON.stringify(getParameters()));
    const fingerprint = () => JSON.stringify([context(), scope.value, service.value, battery.value,
      release?.releaseId, release?.effectiveChecksum, getRows(), getParameters()]);
    const inputs = fingerprint();
    const assertCurrent = () => {
      if (run !== epoch || modal.hidden || token !== context() || inputs !== fingerprint()) {
        throw Error('草稿、物流路线或费用已变化，报价未应用，请重新计算');
      }
    };
    const priceMinor = (price) => {
      const amount = Math.ceil(Number(price) * 100 * (parameters.currency === 'RUB' ? Number(parameters.fxRate) : 1));
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw Error('请填写采购成本、比例费用和有效汇率后计算正数售价');
      return amount;
    };
    busy = true;
    sync();
    void Promise.resolve()
      .then(async () => {
        assertCurrent();
        let declared = rows.map((row) => ({
          skuKey: row.skuKey,
          declaredPriceMinor: priceMinor(calculate({ ...parameters, cost: row.cost, shippingCost: row.shippingCost || 0 }).price),
          hasBattery,
        }));
        let last = null,
          stable = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          assertCurrent();
          const response = await command('LOGISTICS_QUOTE', {
            binding,
            listingWorkflowId: binding.listingWorkflowId,
            selection,
            ...selectedRelease,
            stableServiceKey,
            items: declared,
          });
          assertCurrent();
          last = response.data?.logistics;
          const next = rows.map((row) => {
            const item = last.items.find((item) => item.skuKey === row.skuKey);
            if (!item) throw Error('物流报价缺少当前 SKU');
            const priced = calculate({
              ...parameters,
              cost: row.cost,
              shippingCost: item.shippingCostCny,
            });
            return {
              skuKey: row.skuKey,
              declaredPriceMinor: priceMinor(priced.price),
              hasBattery,
            };
          });
          if (JSON.stringify(next) === JSON.stringify(declared)) {
            stable = true;
            break;
          }
          declared = next;
        }
        if (!stable) throw Error('售价与物流价档未能收敛，请手工核对费用或选择其他物流');
        assertCurrent();
        if (!['validUntil', 'authorizationValidUntil'].every(key => Date.parse(last[key]) > Date.now())) {
          throw Error('物流报价已过期，请重新读取并计算');
        }
        onQuote(last);
        result.replaceChildren(
          ...last.items.map((item) =>
            make('p', '', `${item.skuKey}：运费 ${item.shippingCostCny.toFixed(2)} CNY`),
          ),
        );
        state.textContent =
          '运费已应用，当前售价已通过同一路线价档核验。返回定价窗口检查预览后保存。';
      })
      .catch((error) => {
        if (run !== epoch || modal.hidden) return;
        state.textContent = error.message;
        report(error);
      })
      .finally(() => {
        if (run !== epoch) return;
        busy = false;
        sync();
      });
  });
  return {
    async open() {
      const binding = getBinding();
      if (!binding) throw Error('请先创建店铺草稿');
      const run = ++epoch;
      token = context();
      modal.hidden = false;
      busy = true;
      assignments = [];
      release = null;
      scope.replaceChildren();
      service.replaceChildren();
      result.replaceChildren();
      state.textContent = '正在读取当前店铺的物流授权…';
      sync();
      try {
        const response = await command('LOGISTICS_SCOPES', {
          binding,
          listingWorkflowId: binding.listingWorkflowId,
        });
        if (run !== epoch || modal.hidden || token !== context()) throw Error('草稿已变化');
        const data = response.data?.logistics;
        assignments = data.assignments;
        const empty = make('option', '', '请选择仓库与起讫地');
        empty.value = '';
        scope.append(empty);
        assignments.forEach((item, index) => {
          const option = make(
            'option',
            '',
            `${item.warehouseName} · ${item.originLabel} → ${item.destinationLabel}`,
          );
          option.value = String(index);
          scope.append(option);
        });
        state.textContent = assignments.length
          ? '请选择当前商品发货路线。'
          : '当前店铺没有已授权且已发布的物流路线，请在物流设置中配置。';
        return data;
      } catch (error) {
        if (run !== epoch || modal.hidden) return;
        state.textContent = error.message;
        report(error);
      } finally {
        if (run === epoch) { busy = false; sync(); }
      }
    },
    close() {
      closeModal();
    },
    isBusy() { return busy; },
  };
}
