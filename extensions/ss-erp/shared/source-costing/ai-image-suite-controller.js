(function (root) {
  'use strict';

  function identifier(value, label) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    if (!normalized || normalized.length > 200) throw new TypeError(label + ' is invalid');
    return normalized;
  }

  function positiveRevision(value, label) {
    var normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 1) {
      throw new TypeError(label + ' is invalid');
    }
    return normalized;
  }

  function normalizeBinding(value) {
    return Object.freeze({
      sourceProductId: identifier(value && value.sourceProductId, 'sourceProductId'),
      listingWorkflowId: identifier(value && value.listingWorkflowId, 'listingWorkflowId'),
      shopId: identifier(value && value.shopId, 'shopId'),
      revision: positiveRevision(value && value.revision, 'revision'),
      draftVersion: positiveRevision(value && value.draftVersion, 'draftVersion'),
    });
  }

  function bindingKey(value) {
    var binding = normalizeBinding(value);
    return JSON.stringify([
      binding.sourceProductId,
      binding.listingWorkflowId,
      binding.shopId,
      binding.revision,
      binding.draftVersion,
    ]);
  }

  function errorMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function commandKey(payload) {
    return [
      payload && payload.action || '',
      payload && payload.slotId || '',
      payload && payload.decision || '',
    ].join(':');
  }

  function createController(options) {
    if (!options || typeof options.read !== 'function' || typeof options.execute !== 'function') {
      throw new TypeError('AI image suite controller dependencies are invalid');
    }
    var onState = typeof options.onState === 'function' ? options.onState : function () {};
    var onCommandSuccess = typeof options.onCommandSuccess === 'function'
      ? options.onCommandSuccess
      : function () {};
    var readSequence = 0;
    var state = {
      value: null,
      loading: false,
      error: '',
      busyKey: '',
      epoch: 0,
      binding: null,
      bindingKey: '',
    };

    function publicState() {
      return {
        value: state.value,
        loading: state.loading,
        error: state.error,
        busyKey: state.busyKey,
        epoch: state.epoch,
        binding: state.binding,
        bindingKey: state.bindingKey,
      };
    }

    function publish() {
      onState(publicState());
    }

    function current(key, epoch) {
      return state.bindingKey === key && state.epoch === epoch;
    }

    function activate(value) {
      var binding = normalizeBinding(value);
      var key = bindingKey(binding);
      if (key !== state.bindingKey) {
        state.epoch += 1;
        readSequence += 1;
        state.binding = binding;
        state.bindingKey = key;
        state.value = null;
        state.loading = false;
        state.error = '';
        state.busyKey = '';
        publish();
      }
      return { binding: binding, key: key };
    }

    async function load(bindingValue, metadata) {
      var active = activate(bindingValue);
      var force = metadata && metadata.force === true;
      if ((!force && state.loading) || (!force && state.busyKey)) return state.value;
      var epoch = state.epoch;
      var sequence = ++readSequence;
      state.loading = true;
      state.error = '';
      publish();
      try {
        var value = await options.read(active.binding, metadata || {});
        if (!current(active.key, epoch) || sequence !== readSequence) return state.value;
        state.value = value;
        return value;
      } catch (error) {
        if (!current(active.key, epoch) || sequence !== readSequence) return state.value;
        state.error = errorMessage(error);
        publish();
        throw error;
      } finally {
        if (current(active.key, epoch) && sequence === readSequence) {
          state.loading = false;
          publish();
        }
      }
    }

    async function execute(bindingValue, payload) {
      var active = activate(bindingValue);
      if (state.busyKey) return undefined;
      state.epoch += 1;
      readSequence += 1;
      var epoch = state.epoch;
      var key = active.key;
      var busyKey = commandKey(payload);
      state.loading = false;
      state.error = '';
      state.busyKey = busyKey;
      publish();
      try {
        var result = await options.execute(active.binding, payload);
        if (!current(key, epoch)) return result;
        state.value = null;
        state.error = '';
        publish();
        try {
          await load(active.binding, { reason: 'command', force: true });
        } catch {
          // The command committed. Keep its authoritative reload error without reporting a false command failure.
        }
        if (current(key, epoch)) onCommandSuccess(result);
        return result;
      } catch (error) {
        if (!current(key, epoch)) return undefined;
        state.error = errorMessage(error);
        publish();
        throw error;
      } finally {
        if (current(key, epoch) && state.busyKey === busyKey) {
          state.busyKey = '';
          publish();
        }
      }
    }

    function reset() {
      state.epoch += 1;
      readSequence += 1;
      state.value = null;
      state.loading = false;
      state.error = '';
      state.busyKey = '';
      state.binding = null;
      state.bindingKey = '';
      publish();
    }

    return Object.freeze({
      load: load,
      execute: execute,
      reset: reset,
      syncBinding: function (binding) { activate(binding); return publicState(); },
      getState: publicState,
    });
  }

  root.SS_ERP_SOURCE_AI_IMAGE_SUITE_CONTROLLER = Object.freeze({
    createController: createController,
    bindingKey: bindingKey,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
