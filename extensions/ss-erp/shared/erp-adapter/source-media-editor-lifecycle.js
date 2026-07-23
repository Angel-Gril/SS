(function (root) {
  'use strict';

  function registerTabCleanup(options) {
    var tabsApi = options && options.tabs;
    var getCoordinator = options && options.getCoordinator;
    var onError = options && typeof options.onError === 'function'
      ? options.onError
      : function () {};
    if (!tabsApi || !tabsApi.onRemoved
      || typeof tabsApi.onRemoved.addListener !== 'function'
      || typeof getCoordinator !== 'function') {
      throw new Error('media editor tab cleanup options are invalid');
    }
    var listener = function (tabId) {
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        return Promise.resolve({ state: 'ignored', removed: 0, retained: 0 });
      }
      return Promise.resolve().then(function () {
        var coordinator = getCoordinator();
        if (!coordinator || typeof coordinator.handleTabRemoved !== 'function') {
          throw new Error('media editor tab cleanup coordinator is unavailable');
        }
        return coordinator.handleTabRemoved(tabId);
      }).catch(function (error) {
        onError(error);
        return { state: 'failed', removed: 0, retained: 0 };
      });
    };
    tabsApi.onRemoved.addListener(listener);
    return listener;
  }

  root.SS_ERP_SOURCE_MEDIA_EDITOR_LIFECYCLE = {
    registerTabCleanup: registerTabCleanup,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
