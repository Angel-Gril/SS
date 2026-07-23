import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const clientPath = 'extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js';
const clientSource = fs.readFileSync(clientPath, 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadClient() {
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextEncoder,
    TypeError,
    URL,
    URLSearchParams,
    Uint8Array,
    crypto: webcrypto,
  };
  context.globalThis = context;
  vm.runInNewContext(clientSource, context, { filename: clientPath });
  return context.SS_ERP_LISTING_WORKFLOW_CLIENT;
}

function launchContext() {
  return {
    id: 'listing-1',
    shopId: 'shop-1',
    supplyGoodsId: 'goods-1',
    snapshotId: 'snapshot-1',
    revision: 7,
    draftVersion: 3,
    sourceInputs: [
      { sourceMediaKey: 'main-image' },
      { sourceMediaKey: 'detail-image' },
    ],
    requested: {
      snapshotId: 'snapshot-1',
      listingWorkflowId: 'listing-1',
      revision: 7,
      draftVersion: 3,
    },
  };
}

function capability(operation, overrides = {}) {
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: `${operation} ready`,
    revision: `revision-${operation}`,
    testOnly: true,
    operation,
    ...overrides,
  };
}

const api = loadClient();
assert.equal(typeof api?.createClient, 'function');

{
  const calls = [];
  const client = api.createClient({
    transport: {
      async get(path, options) {
        calls.push({ method: 'GET', path, options });
        return {
          state: 'response',
          status: 200,
          body: {
            code: 1,
            data: {
              contractVersion: 'extension-media-launch/v2',
              revision: 'launch-revision-2',
              operations: {
                IMAGE_TRANSLATE: capability('IMAGE_TRANSLATE', {
                  sourceLanguage: 'zh', targetLanguage: 'ru',
                }),
                IMAGE_TO_IMAGE: capability('IMAGE_TO_IMAGE', { maxReferences: 4 }),
                FULL_EDIT: capability('FULL_EDIT'),
                INPAINT: capability('INPAINT', {
                  maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
                  maxMaskBytes: 20 * 1024 * 1024,
                }),
              },
              context: launchContext(),
            },
          },
        };
      },
      async post() { throw new Error('unexpected POST'); },
    },
  });

  const result = await client.getMediaLaunch({
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-1',
    revision: 7,
    draftVersion: 3,
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.contractVersion, 2);
  assert.equal(result.revision, 'launch-revision-2');
  assert.deepEqual(Object.keys(result.operations).sort(), [
    'FULL_EDIT', 'IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'INPAINT',
  ]);
  assert.equal(result.operations.IMAGE_TO_IMAGE.maxReferences, 4);
  assert.equal(result.context.id, 'listing-1');
  assert.match(calls[0].path, /[?&]contractVersion=2(?:&|$)/u);
  assert.deepEqual(plain(calls[0].options), { requiredScope: 'media:execute' });
}

{
  const validOperations = () => ({
    IMAGE_TRANSLATE: capability('IMAGE_TRANSLATE', {
      sourceLanguage: 'zh', targetLanguage: 'ru',
    }),
    IMAGE_TO_IMAGE: capability('IMAGE_TO_IMAGE', { maxReferences: 4 }),
    FULL_EDIT: capability('FULL_EDIT'),
    INPAINT: capability('INPAINT', {
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
      maxMaskBytes: 20 * 1024 * 1024,
    }),
  });
  const malformed = [
    (operations) => { operations.IMAGE_TO_IMAGE.maxReferences = 5; },
    (operations) => { delete operations.INPAINT.maskSemantics; },
    (operations) => { operations.INPAINT.maxMaskBytes = 0; },
    (operations) => { operations.FULL_EDIT.maxReferences = 1; },
    (operations) => { operations.IMAGE_TRANSLATE.maxMaskBytes = 100; },
  ];
  for (const mutate of malformed) {
    const operations = validOperations();
    mutate(operations);
    const client = api.createClient({
      transport: {
        async get() {
          return { state: 'response', status: 200, body: { code: 1, data: {
            contractVersion: 'extension-media-launch/v2',
            revision: 'launch-revision-2',
            operations,
            context: launchContext(),
          } } };
        },
        async post() { throw new Error('unexpected POST'); },
      },
    });
    await assert.rejects(() => client.getMediaLaunch({
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', revision: 7, draftVersion: 3,
    }), /invalid source media launch v2 response/u);
  }
}

{
  const calls = [];
  const client = api.createClient({
    transport: {
      async get(path) {
        calls.push(path);
        if (calls.length === 1) return { state: 'http_error', status: 400, body: null };
        return {
          state: 'response', status: 200, body: { code: 1, data: {
            capability: capability('IMAGE_TRANSLATE', {
              sourceLanguage: 'zh', targetLanguage: 'ru',
            }),
            context: launchContext(),
          } },
        };
      },
      async post() { throw new Error('unexpected POST'); },
    },
  });
  const result = await client.getMediaLaunch({
    snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
    listingWorkflowId: 'listing-1', revision: 7, draftVersion: 3,
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.contractVersion, 1);
  assert.equal(result.capability.operation, 'IMAGE_TRANSLATE');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1], /contractVersion/u);
}

{
  const posts = [];
  let returnedStatus = 'QUEUED';
  const client = api.createClient({
    transport: {
      async get() { throw new Error('unexpected GET'); },
      async post(path, body, options) {
        posts.push({ path, body, options });
        if (path.endsWith('/command-grants')) {
          return { state: 'response', status: 201, body: { code: 1, data: { grantToken: 'g'.repeat(64) } } };
        }
        return { state: 'response', status: 202, body: { code: 1, data: {
          replay: false,
          receipt: {
            status: 'SUCCEEDED',
            result: {
              workflowId: 'workflow-1', action: 'CREATE_WORKFLOW',
              operation: 'IMAGE_TO_IMAGE', status: returnedStatus, revision: 1,
            },
          },
        } } };
      },
    },
  });

  const result = await client.createWorkflowCommand({
    shopId: 'shop-1',
    listingWorkflowId: 'listing-1',
    draftRevision: 7,
    draftVersion: 3,
    operation: 'IMAGE_TO_IMAGE',
    sourceMediaKeys: ['main-image', 'detail-image'],
    prompt: 'Place the product on a clean studio background',
    negativePrompt: 'No logos',
    workflowOperationKey: 'extension-media-workflow:stable-operation',
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.result.workflowId, 'workflow-1');
  assert.equal(posts.length, 2);
  const issued = posts[0];
  assert.equal(issued.path, '/api/extension-device/command-grants');
  assert.equal(issued.body.operation, 'MEDIA_EXECUTE');
  assert.deepEqual(plain(issued.body.command), {
    schemaVersion: 'ai-media-workflow-create/v2',
    action: 'CREATE_WORKFLOW',
    operation: 'IMAGE_TO_IMAGE',
    sourceMediaKeys: ['main-image', 'detail-image'],
    prompt: 'Place the product on a clean studio background',
    negativePrompt: 'No logos',
    draftRevision: 7,
    workflowOperationKey: 'extension-media-workflow:stable-operation',
  });
  assert.match(issued.body.idempotencyKey, /^extension-media-create:[a-f0-9]{64}$/u);
  assert.deepEqual(plain(issued.options), { requiredScope: 'media:execute' });
  assert.equal(posts[1].path, '/api/extension-device/media-workflows/execute');
  assert.deepEqual(plain(posts[1].body), {
    shopId: issued.body.shopId,
    workflowId: issued.body.workflowId,
    draftVersion: issued.body.draftVersion,
    idempotencyKey: issued.body.idempotencyKey,
    command: plain(issued.body.command),
  });
  assert.deepEqual(plain(posts[1].options), {
    commandGrant: 'g'.repeat(64), requiredScope: 'media:execute',
  });
  const createWorkflowSource = clientSource.slice(
    clientSource.indexOf('async createWorkflowCommand(input)'),
    clientSource.indexOf('async reviewMediaOutput(input)'),
  );
  assert.match(createWorkflowSource, /executeGrantedMediaMutation\(/u);
  assert.doesNotMatch(createWorkflowSource, /\/api\/extension-device\/command-grants/u);

  await assert.rejects(() => client.createWorkflowCommand({
    shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 7, draftVersion: 3,
    operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: ['1', '2', '3', '4', '5'],
    prompt: 'prompt', negativePrompt: '', workflowOperationKey: 'operation-key-valid',
  }), /source media keys/u);
  await assert.rejects(() => client.createWorkflowCommand({
    shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 7, draftVersion: 3,
    operation: 'FULL_EDIT', sourceMediaKeys: ['1', '2'], prompt: 'prompt', negativePrompt: '',
    workflowOperationKey: 'operation-key-valid',
  }), /source media keys/u);
  await assert.rejects(() => client.createWorkflowCommand({
    shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 7, draftVersion: 3,
    operation: 'INPAINT', sourceMediaKeys: ['1'], prompt: 'prompt', negativePrompt: '',
    workflowOperationKey: 'operation-key-valid',
  }), /maskAssetId/u);

  returnedStatus = 'FAILED';
  await assert.rejects(() => client.createWorkflowCommand({
    shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 7, draftVersion: 3,
    operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: ['main-image'],
    prompt: 'prompt', negativePrompt: '',
    workflowOperationKey: 'extension-media-workflow:failed-status',
  }), /media workflow command did not complete/u);
}

{
  const viewPath = 'extensions/ss-erp/content/source-listing-workbench.js';
  const viewSource = fs.readFileSync(viewPath, 'utf8');
  class TestNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.className = '';
      this.textContent = '';
      this.hidden = true;
      this.disabled = false;
      this.attributes = {};
      this.listeners = {};
      this.classList = { add: (...names) => names.forEach((name) => { this.className += ` ${name}`; }) };
    }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    get firstChild() { return this.children[0] || null; }
  }
  const viewContext = {
    document: { createElement: (tag) => new TestNode(tag) },
    window: {},
  };
  vm.runInNewContext(viewSource, viewContext, { filename: viewPath });
  const nodes = (root) => [root, ...root.children.flatMap(nodes)];
  const renderedText = (root) => nodes(root).map((node) => node.textContent).filter(Boolean).join(' ');
  const listing = {
    id: 'listing-1', shopId: 'shop-1', revision: 7, draftVersion: 3,
    selectedSkuCount: 1, mediaAssignmentCount: 1, blockerCount: 0, warningCount: 0,
    blockers: [],
  };
  const result = {
    state: 'ready',
    status: {
      snapshot: { current: true },
      listing: { items: [listing] },
      media: { actionableCount: 0, items: [] },
    },
  };
  const launch = {
    state: 'ready', contractVersion: 2, revision: 'launch-revision-2',
    operations: {
      IMAGE_TRANSLATE: capability('IMAGE_TRANSLATE', { sourceLanguage: 'zh', targetLanguage: 'ru' }),
      IMAGE_TO_IMAGE: capability('IMAGE_TO_IMAGE', { maxReferences: 4 }),
      FULL_EDIT: capability('FULL_EDIT'),
      INPAINT: capability('INPAINT', {
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maxMaskBytes: 20 * 1024 * 1024,
      }),
    },
    context: launchContext(),
  };
  const sourceInputs = [
    { sourceMediaKey: 'main-image', label: '主图 1', url: 'https://images.example/main.png' },
    { sourceMediaKey: 'detail-image', label: '详情图 2', url: 'https://images.example/detail.png' },
  ];
  const draftChanges = [];
  const draftChangeMetadata = [];
  const editorOpens = [];
  const drawerOpenChanges = [];
  const createDraft = {
    operation: 'IMAGE_TO_IMAGE',
    sourceMediaKeys: ['main-image'],
  };
  const container = new TestNode('section');
  viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(container, result, {
    launch,
    sourceInputs,
    selectedListingWorkflowId: 'listing-1',
    mediaCreateDraft: createDraft,
    onMediaCreateDraftChange(value, metadata) {
      draftChanges.push(plain(value));
      draftChangeMetadata.push(metadata === undefined ? null : plain(metadata));
    },
    onMediaCreateOpenChange(value) { drawerOpenChanges.push(value); },
    onOpenMediaEditor(value) { editorOpens.push(plain(value)); },
  });

  assert.match(renderedText(container), /AI 修图与生图/u);
  for (const operation of ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
  assert.ok(nodes(container).find((node) => node.attributes['data-media-operation'] === operation));
  }
  assert.equal(nodes(container).filter((node) => node.tag === 'img').length, 2);
  assert.equal(nodes(container).filter((node) => node.tag === 'textarea').length, 0);
  const createButton = nodes(container).find((node) => node.textContent === '配置参考生图');
  assert.ok(createButton);
  createButton.listeners.click({ isTrusted: false });
  assert.equal(editorOpens.length, 0);
  createButton.listeners.click({ isTrusted: true });
  assert.deepEqual(editorOpens, [createDraft]);

  const detailToggle = nodes(container)
    .find((node) => node.attributes['data-source-media-key'] === 'detail-image');
  detailToggle.checked = true;
  detailToggle.listeners.change({ isTrusted: true });
  assert.deepEqual(draftChanges[0].sourceMediaKeys, ['main-image', 'detail-image']);
  assert.deepEqual(draftChangeMetadata[0], { structural: true });

  const fullEditButton = nodes(container)
    .find((node) => node.attributes['data-media-operation'] === 'FULL_EDIT');
  fullEditButton.listeners.click({ isTrusted: false });
  assert.equal(draftChanges.length, 1);
  fullEditButton.listeners.click({ isTrusted: true });
  assert.equal(draftChanges[1].operation, 'FULL_EDIT');
  assert.deepEqual(draftChanges[1].sourceMediaKeys, ['main-image']);
  assert.deepEqual(draftChangeMetadata[1], { structural: true });

  const mediaDrawer = nodes(container)
    .find((node) => node.className.includes('ss-erp-source-workbench-media-create'));
  mediaDrawer.open = true;
  mediaDrawer.listeners.toggle({ isTrusted: true });
  assert.deepEqual(drawerOpenChanges, [true]);

  const inpaintContainer = new TestNode('section');
  const inpaintDraft = {
    operation: 'INPAINT', sourceMediaKeys: ['main-image'],
  };
  viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(inpaintContainer, result, {
    launch,
    sourceInputs,
    selectedListingWorkflowId: 'listing-1',
    mediaCreateDraft: inpaintDraft,
    onMediaCreateDraftChange(value) { draftChanges.push(plain(value)); },
    onOpenMediaEditor(value) { editorOpens.push(plain(value)); },
  });
  const editorButton = nodes(inpaintContainer).find((node) => node.textContent === '打开局部重绘');
  assert.ok(editorButton);
  editorButton.listeners.click({ isTrusted: true });
  assert.deepEqual(editorOpens, [createDraft, inpaintDraft]);

  const styleSource = fs.readFileSync(
    'extensions/ss-erp/content/source-listing-workbench.css',
    'utf8',
  );
  assert.match(styleSource, /\.ss-erp-source-workbench-operation-tabs\s*\{/u);
  assert.match(styleSource, /\.ss-erp-source-workbench-source-gallery\s*\{/u);
  assert.match(styleSource, /\.ss-erp-source-workbench-source-card\.is-selected/u);
  assert.doesNotMatch(viewSource, /createElement\(['"]textarea['"]\)|element\(['"]textarea['"]/u);
}

{
  const worker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
  const panel = fs.readFileSync('extensions/ss-erp/content/source-costing-panel.js', 'utf8');
  assert.doesNotMatch(worker, /source-media-create-intent|requestFingerprint/u);
  const directMediaHandler = worker.slice(
    worker.indexOf('if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_COMMAND_MESSAGE)'),
    worker.indexOf('if (OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type))'),
  );
  assert.ok(directMediaHandler.length > 0);
  assert.doesNotMatch(
    directMediaHandler,
    /message\.action\s*===\s*['"]CREATE_WORKFLOW['"]/u,
  );
  const createExecutor = worker.slice(
    worker.indexOf('async function executeSourceMediaCreateWorkflow'),
    worker.indexOf('function getSourceMediaEditorContract'),
  );
  assert.match(createExecutor, /input\?\.client/u);
  assert.match(createExecutor, /draftRevision:\s*revision/u);
  assert.match(createExecutor, /draftVersion/u);
  assert.match(createExecutor, /\^\[a-f0-9\]\{64\}\$/u);
  assert.match(createExecutor, /attemptId\.slice\(0, 32\)/u);
  assert.match(createExecutor, /extension-media-workflow:/u);
  assert.match(createExecutor, /client\.createWorkflowCommand/u);
  assert.doesNotMatch(createExecutor, /provider|model|api.?key|secret/iu);

  const editorAuthority = worker.slice(
    worker.indexOf('function sameSourceMediaEditorPreparedSource'),
    worker.indexOf('async function sourceMediaMaskSha256'),
  );
  assert.match(editorAuthority, /readPersistedSourceWorkflowHandoff/u);
  assert.match(editorAuthority, /client\.getStatus/u);
  assert.match(editorAuthority, /client\.getMediaLaunch/u);
  for (const field of [
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'revision', 'draftVersion',
  ]) {
    assert.match(editorAuthority, new RegExp(`session\\.${field}`, 'u'));
  }
  assert.match(editorAuthority, /sourceAssetId\s*===\s*latest\.sourceAssetId/u);
  assert.match(editorAuthority, /width\s*===\s*latest\.width/u);
  assert.match(editorAuthority, /height\s*===\s*latest\.height/u);
  assert.match(editorAuthority, /launch\.context\.snapshotId\s*!==\s*request\.snapshotId/u);

  assert.match(panel, /sourceWorkbenchMediaCreateDraft/u);
  assert.match(panel, /onMediaCreateDraftChange/u);
  assert.match(panel, /onOpenMediaEditor/u);
  const panelCreate = panel.slice(
    panel.indexOf('async function openSourceWorkbenchMediaEditor'),
    panel.indexOf('async function loadSourceWorkbenchMediaHistory'),
  );
  assert.ok(panelCreate.length > 0);
  assert.match(panelCreate, /media-editor-open/u);
  assert.match(panelCreate, /operation/u);
  assert.match(panelCreate, /sourceMediaKeys/u);
  for (const field of ['snapshotId', 'supplyGoodsId', 'shopId', 'revision', 'draftVersion']) {
    assert.match(panelCreate, new RegExp(`launchContext\\.${field}`, 'u'));
  }
  assert.doesNotMatch(
    panelCreate,
    /prompt|provider|model|api.?key|secret/iu,
  );
}

console.log('PASS extension source standalone media contract');
