(function (root) {
  'use strict';

  function create(handler) {
    if (typeof handler !== 'function') throw new TypeError('device claim handler is required');
    var tail = Promise.resolve();
    function append(operationHandler) {
      var operation = tail.then(operationHandler);
      tail = operation.then(function () {}, function () {});
      return operation;
    }
    function enqueue(message, sender) {
      return append(function () {
        return handler(message, sender);
      });
    }
    enqueue.afterIdle = function (reader) {
      if (typeof reader !== 'function') throw new TypeError('device status reader is required');
      return append(reader);
    };
    enqueue.whenIdle = function () {
      return tail;
    };
    return enqueue;
  }

  root.SS_ERP_EXTENSION_DEVICE_CLAIM_QUEUE = Object.freeze({ create: create });
}(typeof globalThis !== 'undefined' ? globalThis : self));
