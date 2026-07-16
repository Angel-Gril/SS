(function (root) {
  'use strict';

  var FEATURE_OFF_CODES = new Set([
    'source_capture_v2_not_enabled',
    'source_capture_v2_disabled',
    'source_capture_v2_not_supported',
    'command_operation_unavailable'
  ]);

  function requiredApi(value, label, methods) {
    if (!value || typeof value !== 'object') throw new Error(label + ' is unavailable');
    (methods || []).forEach(function (method) {
      if (typeof value[method] !== 'function') throw new Error(label + '.' + method + ' is unavailable');
    });
    return value;
  }

  function responseError(response, fallback) {
    var message = response && (response.msg || response.message || response.error);
    return new Error(String(message || fallback));
  }

  function isFeatureOff(response) {
    return Boolean(response && FEATURE_OFF_CODES.has(String(response.errorCode || '')));
  }

  function createSubmitter(options) {
    var credentials = requiredApi(options && options.credentials, 'device credentials', [
      'beginOperation',
      'isOperationCurrent'
    ]);
    var client = requiredApi(options && options.client, 'ERP client', [
      'requestSourceCaptureGrant',
      'submitSourceCaptureV2'
    ]);
    var contract = requiredApi(options && options.contract, 'source capture contract', [
      'createSourceProductCaptureV2Submission',
      'validateSourceProductCaptureV2Submission'
    ]);

    async function assertCurrent(operation) {
      if (!await credentials.isOperationCurrent(operation)) {
        throw new Error('扩展设备授权已变化，请重新采集');
      }
    }

    async function submit(capture) {
      var operation = await credentials.beginOperation();
      if (!operation || operation.state === 'unpaired') {
        return { state: 'legacy_compatible', reason: 'unpaired' };
      }
      if (operation.state !== 'paired') throw new Error('扩展设备凭据不可用');
      if (!Array.isArray(operation.scopes) || !operation.scopes.includes('capture:write')) {
        throw new Error('扩展设备缺少 capture:write 权限');
      }

      await assertCurrent(operation);
      var submission = await contract.createSourceProductCaptureV2Submission(capture);
      var validation = contract.validateSourceProductCaptureV2Submission(submission);
      if (!validation || validation.valid !== true) {
        var validationMessage = validation && Array.isArray(validation.errors)
          ? validation.errors.map(function (item) { return item && item.message; }).filter(Boolean).slice(0, 3).join('; ')
          : '';
        throw new Error('来源采集 V2 数据无效' + (validationMessage ? ': ' + validationMessage : ''));
      }
      var command = {
        schemaVersion: submission.capture.captureVersion,
        platform: submission.capture.platform,
        sourceProductId: submission.capture.sourceIdentity.productId,
        captureHash: submission.captureHash,
        payloadBytes: submission.payloadBytes
      };
      var idempotencyKey = 'source-capture-' + submission.captureHash;

      await assertCurrent(operation);
      var grantResponse = await client.requestSourceCaptureGrant(operation, {
        idempotencyKey: idempotencyKey,
        command: command
      });
      await assertCurrent(operation);
      if (!grantResponse || grantResponse.code !== 1) {
        if (isFeatureOff(grantResponse)) {
          return { state: 'legacy_compatible', reason: 'feature_off' };
        }
        throw responseError(grantResponse, '来源采集 V2 授权失败');
      }

      var grantToken = String(grantResponse.data && grantResponse.data.grantToken || '').trim();
      if (!grantToken) throw new Error('来源采集 V2 授权响应缺少 grant token');
      await assertCurrent(operation);
      var captureResponse = await client.submitSourceCaptureV2(operation, {
        capture: submission.capture,
        captureHash: submission.captureHash,
        payloadBytes: submission.payloadBytes,
        grantToken: grantToken,
        idempotencyKey: idempotencyKey
      });
      await assertCurrent(operation);
      if (!captureResponse || captureResponse.code !== 1) {
        throw responseError(captureResponse, '来源采集 V2 写入失败');
      }
      return {
        state: 'submitted',
        data: captureResponse.data || null
      };
    }

    return { submit: submit };
  }

  root.SS_ERP_SOURCE_CAPTURE_SUBMIT = {
    createSubmitter: createSubmitter
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
