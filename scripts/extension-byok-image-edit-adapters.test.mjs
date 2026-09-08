import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const adapterPath = 'extensions/ss-erp/shared/byok/image-edit-adapters.js';

function loadApi(overrides = {}) {
  const context = {
    Array,
    Blob,
    Boolean,
    Error,
    FormData: overrides.FormData || FormData,
    JSON,
    Math,
    Number,
    Object,
    Set,
    String,
    TextEncoder,
    TypeError,
    URL,
    Uint8Array,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
  vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context, { filename: adapterPath });
  return context.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS;
}

function image(overrides = {}) {
  const mimeType = overrides.mimeType || 'image/png';
  return {
    blob: overrides.blob || new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }),
    mimeType,
    width: 1024,
    height: 1024,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    apiBaseUrl: 'https://relay.example/v1',
    operation: 'FULL_EDIT',
    model: 'image-edit-v1',
    prompt: 'Keep the product factual and edit the background',
    negativePrompt: null,
    size: '1024x1024',
    images: [image()],
    mask: null,
    ...overrides,
  };
}

function asyncEnvelope(overrides = {}) {
  return {
    contractVersion: 'extension-byok-image-edit-async-task/v1',
    taskId: 'task-123',
    state: 'PENDING',
    ...overrides,
  };
}

function asyncPoll(overrides = {}) {
  return {
    contractVersion: 'extension-byok-image-edit-async-task/v1',
    taskId: 'task-123',
    state: 'PENDING',
    result: null,
    errorCode: null,
    ...overrides,
  };
}

test('exports two frozen versioned adapters through a closed exact resolver', () => {
  const api = loadApi();
  assert.equal(api.CONTRACT_VERSION, 'extension-byok-image-edit-adapters/v1');
  assert.equal(api.OPENAI_MULTIPART_SYNC_V1, 'openai-images-edits-multipart-sync/v1');
  assert.equal(api.EXPLICIT_ASYNC_TASK_V1, 'ss-erp-images-edits-explicit-async-task/v1');
  assert.deepEqual(Array.from(api.ADAPTER_IDS), [
    api.OPENAI_MULTIPART_SYNC_V1,
    api.EXPLICIT_ASYNC_TASK_V1,
  ]);
  for (const id of api.ADAPTER_IDS) {
    const adapter = api.resolveAdapter(id);
    assert.equal(adapter.id, id);
    assert.equal(Object.isFrozen(adapter), true);
  }
  assert.equal(api.resolveAdapter(api.OPENAI_MULTIPART_SYNC_V1), api.OPENAI_MULTIPART_SYNC);
  assert.equal(api.resolveAdapter(api.EXPLICIT_ASYNC_TASK_V1), api.EXPLICIT_ASYNC_TASK);
  for (const invalid of ['', 'openai', 'multipart', 'async', null, {}, api.OPENAI_MULTIPART_SYNC]) {
    assert.throws(
      () => api.resolveAdapter(invalid),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_ADAPTER_UNSUPPORTED',
    );
  }
});

test('builds strict OpenAI multipart requests for full edit, references, and inpaint', () => {
  const api = loadApi();
  const adapter = api.OPENAI_MULTIPART_SYNC;

  const full = adapter.createSubmitRequest(request({
    negativePrompt: 'Do not invent labels',
  }));
  assert.equal(full.adapterId, api.OPENAI_MULTIPART_SYNC_V1);
  assert.equal(full.requestMode, 'multipart');
  assert.equal(
    adapter.maskSemantics,
    'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1',
  );
  assert.equal(full.endpoint, 'https://relay.example/v1/images/edits');
  assert.equal(full.method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(full.headers)), { Accept: 'application/json' });
  assert.equal(full.credentials, 'omit');
  assert.equal(full.redirect, 'error');
  assert.equal(full.body.get('model'), 'image-edit-v1');
  assert.equal(full.body.get('prompt'), `${request().prompt}\n\nAvoid: Do not invent labels`);
  assert.equal(full.body.get('n'), '1');
  assert.equal(full.body.get('size'), '1024x1024');
  assert.equal(full.body.getAll('image').length, 1);
  assert.equal(full.body.getAll('image[]').length, 0);
  assert.equal(full.body.has('mask'), false);
  assert.equal(Object.keys(full.headers).some((key) => key.toLowerCase() === 'content-type'), false);

  const references = adapter.createSubmitRequest(request({
    operation: 'IMAGE_TO_IMAGE',
    images: [image(), image({ mimeType: 'image/webp' })],
  }));
  assert.equal(references.body.getAll('image').length, 0);
  assert.equal(references.body.getAll('image[]').length, 2);
  assert.deepEqual(
    references.body.getAll('image[]').map((entry) => ({ name: entry.name, type: entry.type })),
    [
      { name: 'image-1.png', type: 'image/png' },
      { name: 'image-2.webp', type: 'image/webp' },
    ],
  );

  const inpaint = adapter.createSubmitRequest(request({
    operation: 'INPAINT',
    mask: {
      ...image(),
      maskSemantics: 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1',
    },
  }));
  assert.equal(inpaint.body.getAll('image').length, 1);
  assert.deepEqual(
    { name: inpaint.body.get('mask').name, type: inpaint.body.get('mask').type },
    { name: 'mask.png', type: 'image/png' },
  );
});

test('rejects operation, media, byte, and mask mismatches before constructing multipart', () => {
  let formCount = 0;
  class CountingFormData extends FormData {
    constructor(...args) {
      super(...args);
      formCount += 1;
    }
  }
  const adapter = loadApi({ FormData: CountingFormData }).OPENAI_MULTIPART_SYNC;
  const invalidRequests = [
    request({ operation: 'TEXT_TO_IMAGE' }),
    request({ operation: 'IMAGE_TO_IMAGE', images: [] }),
    request({ operation: 'IMAGE_TO_IMAGE', images: Array.from({ length: 5 }, () => image()) }),
    request({ operation: 'FULL_EDIT', images: [image(), image()] }),
    request({ operation: 'FULL_EDIT', mask: image() }),
    request({ operation: 'INPAINT', mask: null }),
    request({
      operation: 'INPAINT',
      mask: {
        ...image({ width: 1023 }),
        maskSemantics: 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1',
      },
    }),
    request({
      operation: 'INPAINT',
      mask: {
        ...image({ mimeType: 'image/jpeg' }),
        maskSemantics: 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1',
      },
    }),
    request({
      operation: 'INPAINT',
      mask: { ...image(), maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1' },
    }),
    request({ images: [image({ width: 4097 })] }),
    request({ images: [image({ blob: new Blob([], { type: 'image/png' }) })] }),
    request({ images: [image({ mimeType: 'image/gif' })] }),
    request({ images: [image({ blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) })] }),
  ];
  for (const invalid of invalidRequests) {
    assert.throws(
      () => adapter.createSubmitRequest(invalid),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_REQUEST_INVALID',
    );
  }

  const seventeenMiB = new Blob(
    [new Uint8Array(17 * 1024 * 1024)],
    { type: 'image/png' },
  );
  assert.throws(
    () => adapter.createSubmitRequest(request({
      operation: 'IMAGE_TO_IMAGE',
      images: Array.from({ length: 3 }, () => image({ blob: seventeenMiB })),
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_REQUEST_INVALID',
  );
  assert.equal(formCount, 0);
});

test('normalizes exactly one synchronous b64_json XOR url result and rejects task shapes', () => {
  const adapter = loadApi().OPENAI_MULTIPART_SYNC;
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizeSubmitResponse({
    created: 123,
    data: [{ b64_json: 'AQID' }],
  }))), {
    kind: 'IMAGE_RESULT',
    source: 'b64_json',
    b64Json: 'AQID',
    url: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizeSubmitResponse({
    id: 'request-1',
    data: [{ url: 'https://results.example/image.png?signature=abc' }],
  }))), {
    kind: 'IMAGE_RESULT',
    source: 'url',
    b64Json: null,
    url: 'https://results.example/image.png?signature=abc',
  });

  const invalid = [
    {},
    { data: [] },
    { data: [{ b64_json: 'AQID' }, { b64_json: 'AQID' }] },
    { data: [{}] },
    { data: [{ b64_json: 'AQID', url: 'https://results.example/image.png' }] },
    { data: [{ b64_json: 'not base64' }] },
    { data: [{ url: 'http://results.example/image.png' }] },
    { data: [{ url: 'https://user:pass@results.example/image.png' }] },
    { data: [{ b64_json: 'AQID' }], taskId: 'task-1' },
    { data: [{ b64_json: 'AQID' }], status: 'succeeded' },
    asyncEnvelope(),
  ];
  for (const body of invalid) {
    assert.throws(
      () => adapter.normalizeSubmitResponse(body),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID',
    );
  }
});

test('discards OpenAI image response metadata while retaining the exact image result', () => {
  const adapter = loadApi().OPENAI_MULTIPART_SYNC;
  const metadata = {
    background: 'opaque', output_format: 'png', quality: 'high', size: '1024x1024',
    usage: {
      input_tokens: 25, output_tokens: 100, total_tokens: 125,
      input_tokens_details: { image_tokens: 20, text_tokens: 5 },
      output_tokens_details: { image_tokens: 100, text_tokens: 0 },
    },
  };
  for (const extra of [...Object.entries(metadata).map(([key, value]) => ({ [key]: value })), metadata]) {
    for (const item of [{ b64_json: 'AQID' }, { url: 'https://results.example/image.png' }]) {
      const base = { created: 123, data: [item] };
      assert.deepEqual(
        JSON.parse(JSON.stringify(adapter.normalizeSubmitResponse({ ...base, ...extra }))),
        JSON.parse(JSON.stringify(adapter.normalizeSubmitResponse(base))),
      );
    }
  }
});

test('image metadata cannot authorize malformed results, unknown fields, or async tasks', () => {
  const adapter = loadApi().OPENAI_MULTIPART_SYNC;
  const metadata = { usage: { total_tokens: 1 }, output_format: 'png', size: '1024x1024' };
  for (const body of [
    {},
    { data: [] },
    { data: [{ b64_json: 'AQID' }, { b64_json: 'AQID' }] },
    { data: [{ b64_json: 'AQID', url: 'https://results.example/image.png' }] },
    { data: [{ b64_json: 'not base64' }] },
    { data: [{ b64_json: 'AQID' }], error: { message: 'not a successful response' } },
    { data: [{ b64_json: 'AQID' }], taskId: 'task-1' },
    asyncEnvelope(),
  ]) {
    assert.throws(
      () => adapter.normalizeSubmitResponse({ ...body, ...metadata }),
      (error) => error?.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID',
    );
  }
});

test('uses an explicit async submit contract and never sniffs a synchronous response', () => {
  const api = loadApi();
  const adapter = api.EXPLICIT_ASYNC_TASK;
  const submit = adapter.createSubmitRequest(request());
  assert.equal(submit.adapterId, api.EXPLICIT_ASYNC_TASK_V1);
  assert.equal(submit.requestMode, 'async');
  assert.equal(
    adapter.maskSemantics,
    'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1',
  );
  assert.equal(
    submit.headers['X-SS-ERP-Async-Task-Contract'],
    api.ASYNC_TASK_CONTRACT_VERSION,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizeSubmitResponse(asyncEnvelope()))), {
    kind: 'ASYNC_TASK',
    taskId: 'task-123',
    state: 'PENDING',
  });

  for (const body of [
    { data: [{ b64_json: 'AQID' }] },
    asyncEnvelope({ state: 'SUCCEEDED' }),
    asyncEnvelope({ taskId: '../secret' }),
    { ...asyncEnvelope(), pollUrl: 'https://other.example/task-123' },
  ]) {
    assert.throws(
      () => adapter.normalizeSubmitResponse(body),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_TASK_INVALID',
    );
  }
});

test('derives a GET-only poll request from the same API base and accepted task id', () => {
  const api = loadApi();
  const adapter = api.EXPLICIT_ASYNC_TASK;
  const poll = adapter.createPollRequest({
    apiBaseUrl: 'https://relay.example/v1',
    taskId: 'task-123',
  });
  assert.equal(poll.endpoint, 'https://relay.example/v1/images/tasks/task-123');
  assert.equal(poll.method, 'GET');
  assert.equal(Object.prototype.hasOwnProperty.call(poll, 'body'), false);
  assert.equal(poll.credentials, 'omit');
  assert.equal(poll.redirect, 'error');
  assert.equal(
    poll.headers['X-SS-ERP-Async-Task-Contract'],
    api.ASYNC_TASK_CONTRACT_VERSION,
  );
  for (const input of [
    { apiBaseUrl: 'https://other.example/v1/images/tasks', taskId: 'task-123' },
    { apiBaseUrl: 'https://relay.example/v1?target=other', taskId: 'task-123' },
    { apiBaseUrl: 'https://relay.example/v1', taskId: '../secret' },
    { apiBaseUrl: 'https://relay.example/v1', taskId: 'x'.repeat(201) },
  ]) {
    assert.throws(
      () => adapter.createPollRequest(input),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_TASK_INVALID',
    );
  }
});

test('normalizes only bounded explicit pending, succeeded, failed, and cancelled task states', () => {
  const adapter = loadApi().EXPLICIT_ASYNC_TASK;
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizePollResponse(
    asyncPoll(),
    'task-123',
  ))), {
    kind: 'ASYNC_TASK_STATUS',
    taskId: 'task-123',
    state: 'PENDING',
    terminal: false,
    image: null,
    errorCode: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizePollResponse(asyncPoll({
    state: 'SUCCEEDED',
    result: { data: [{ b64_json: 'AQID' }] },
  }), 'task-123'))), {
    kind: 'ASYNC_TASK_STATUS',
    taskId: 'task-123',
    state: 'SUCCEEDED',
    terminal: true,
    image: {
      kind: 'IMAGE_RESULT',
      source: 'b64_json',
      b64Json: 'AQID',
      url: null,
    },
    errorCode: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizePollResponse(asyncPoll({
    state: 'FAILED',
    errorCode: 'CONTENT_REJECTED',
  }), 'task-123'))), {
    kind: 'ASYNC_TASK_STATUS',
    taskId: 'task-123',
    state: 'FAILED',
    terminal: true,
    image: null,
    errorCode: 'CONTENT_REJECTED',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.normalizePollResponse(asyncPoll({
    state: 'CANCELLED',
  }), 'task-123'))), {
    kind: 'ASYNC_TASK_STATUS',
    taskId: 'task-123',
    state: 'CANCELLED',
    terminal: true,
    image: null,
    errorCode: null,
  });

  const invalid = [
    asyncPoll({ state: 'RUNNING' }),
    asyncPoll({ taskId: 'task-other' }),
    asyncPoll({ state: 'PENDING', result: { data: [{ b64_json: 'AQID' }] } }),
    asyncPoll({ state: 'SUCCEEDED', result: null }),
    asyncPoll({ state: 'FAILED', errorCode: null }),
    asyncPoll({ state: 'FAILED', errorCode: 'unsafe value' }),
    { ...asyncPoll(), providerMessage: 'do not reflect me' },
  ];
  for (const body of invalid) {
    assert.throws(
      () => adapter.normalizePollResponse(body, 'task-123'),
      (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_TASK_INVALID',
    );
  }
});
