(function (root) {
  'use strict';
  function create(options) {
    var source = '',
      shops = [],
      index = 0,
      epoch = 0,
      running = false;
    var state = { status: 'IDLE', shopId: '', stepId: '', message: '', completedShopIds: [] };
    function snapshot() {
      return Object.assign({}, state, { completedShopIds: state.completedShopIds.slice() });
    }
    function publish(fields) {
      state = Object.assign({}, state, fields);
      if (options.onState) options.onState(snapshot());
      return snapshot();
    }
    function current(expected) {
      if (expected !== epoch) return false;
      if (options.getSource() === source) return true;
      publish({ status: 'CONTEXT_CHANGED', message: '来源商品已变化，请重新开始当前商品的处理。' });
      return false;
    }
    function currentShop(expected) {
      if (!current(expected)) return false;
      if (!options.getCurrentShop || options.getCurrentShop() === shops[index]) return true;
      publish({ status: 'CONTEXT_CHANGED', message: '处理期间店铺已切换，请重新开始当前店铺。' });
      return false;
    }
    async function run() {
      if (running) throw new Error('正在处理，请等待当前步骤完成');
      if (state.status === 'RECOVERY_REQUIRED') throw new Error('先核对原请求，再继续处理');
      var expected = epoch;
      running = true;
      try {
        while (index < shops.length) {
          if (!current(expected)) return snapshot();
          try {
            await options.selectShop(shops[index]);
          } catch (error) {
            if (!currentShop(expected)) return snapshot();
            return publish({
              status: error.outcome === 'UNKNOWN_OUTCOME' ? 'RECOVERY_REQUIRED' : 'WAITING_INPUT',
              shopId: shops[index],
              message: error.message || '店铺草稿尚未准备好。',
            });
          }
          if (!currentShop(expected)) return snapshot();
          for (var step of options.steps) {
            publish({
              status: 'RUNNING',
              shopId: shops[index],
              stepId: step.id,
              message: step.label || step.id,
            });
            var result;
            try {
              result = await step.run(shops[index]);
            } catch (error) {
              if (!currentShop(expected)) return snapshot();
              return publish({
                status: error.outcome === 'UNKNOWN_OUTCOME' ? 'RECOVERY_REQUIRED' : 'WAITING_INPUT',
                message: error.message || '当前步骤未完成，请处理后继续。',
              });
            }
            if (!currentShop(expected)) return snapshot();
            if (!result || !result.completed)
              return publish({
                status: 'WAITING_INPUT',
                message: result?.message || step.label || step.id,
              });
          }
          if (!currentShop(expected)) return snapshot();
          state.completedShopIds.push(shops[index]);
          index += 1;
        }
        return publish({
          status: 'COMPLETE',
          stepId: '',
          message: '所选店铺的商品准备已完成，请检查上架预览。',
        });
      } finally {
        running = false;
      }
    }
    return {
      async start(selectedShops) {
        if (running) throw new Error('正在处理，请等待当前步骤完成');
        if (state.status === 'RECOVERY_REQUIRED') throw new Error('先核对原请求，再开始新处理');
        if (
          !Array.isArray(selectedShops) ||
          !selectedShops.length ||
          selectedShops.length > 20 ||
          selectedShops.some((shop) => typeof shop !== 'string' || !shop) ||
          new Set(selectedShops).size !== selectedShops.length
        )
          throw new Error('请选择不同的已授权店铺');
        epoch += 1;
        source = options.getSource();
        shops = selectedShops.slice();
        index = 0;
        state.completedShopIds = [];
        return run();
      },
      continue: run,
      state: snapshot,
      isRunning: function () {
        return running;
      },
      cancel: function () {
        epoch += 1;
        return publish({
          status: 'STOPPED',
          message: '已停止后续步骤；已发送的请求仍需核对原结果。',
        });
      },
      markRecovered: function () {
        if (state.status === 'RECOVERY_REQUIRED')
          publish({ status: 'WAITING_INPUT', message: '原请求已核对，可以继续。' });
      },
    };
  }
  root.SS_ERP_PRECISION_PREPARATION_FLOW = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : self);
