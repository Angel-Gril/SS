import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

function once(pattern: RegExp) {
  expect(source.match(pattern)).toHaveLength(1);
}

describe('extension hosted AI image production registration', () => {
  it('registers mode lock, plan, one-use preview, and listing assignment routes once', () => {
    once(/app\.register\(extensionHostedAiImageModeLockRoutes/gu);
    once(/app\.register\(extensionHostedAiImagePlanRoutes/gu);
    once(/app\.register\(extensionHostedCandidatePreviewRoutes/gu);
    once(/app\.register\(extensionHostedAiImageListingAssignmentRoutes/gu);

    expect(source).toContain('service: extensionHostedAiImageModeLockService');
    expect(source).toContain('service: extensionHostedAiImagePlanRouteService');
    expect(source).toContain('service: extensionHostedCandidatePreviewService');
    expect(source).toContain('service: extensionHostedListingAssignmentService');
    expect(source).toContain('authenticateDevice: authenticateExtensionHostedAiImageDevice');
  });

  it('keeps read-only mode lock discovery independent from hosted execution policy', () => {
    expect(source).toMatch(
      /createExtensionHostedAiImageModeLockService\(\{[\s\S]*loadAuthority:[\s\S]*hasHostedSuite:[\s\S]*evaluatePolicy:/gu,
    );
    expect(source).toContain('createPrismaExtensionHostedAiImageModeLockLoader(prisma)');
    expect(source).not.toMatch(
      /hasHostedSuite:[^\n]*decision\.enabled/gu,
    );
  });

  it('composes every hosted mutation with the default-off policy evaluator', () => {
    expect(source).toContain('createExtensionHostedAiImagePolicyEvaluator()');
    expect(source).toContain('evaluatePolicy: evaluateExtensionHostedAiImagePolicy');
    expect(source).toMatch(
      /extensionHostedListingAssignmentService[\s\S]*evaluateExtensionHostedAiImagePolicy[\s\S]*if \(!decision\.enabled\) throw/gu,
    );
    expect(source).toMatch(
      /getAiImageSuiteEnabled:[\s\S]*feature_extension_hosted_ai[\s\S]*getAiImageSuiteDispatchAuthorization/gu,
    );
    expect(source).toMatch(
      /cancel: async \(input\) => \{\s*await assertExtensionAiImageSuiteWriteEnabled\(input\);/gu,
    );
  });

  it('recovers only exact existing-suite reads while keeping plan mutations on the write service', () => {
    const recoveryStart = source.indexOf('const findExtensionHostedAiImageRecoveryBinding');
    const recoveryEnd = source.indexOf('const extensionHostedAiImagePlanningService', recoveryStart);
    const recovery = source.slice(recoveryStart, recoveryEnd);
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recovery).toContain('modeLock.state !== \'HAS_SUITE\'');
    expect(recovery).toContain("getConfig('feature_extension_hosted_ai')");
    expect(recovery).toContain('hostedFeatureEnabled !== false');
    expect(recovery).toContain('identity: input.identity');
    expect(recovery).toContain('extensionHostedAiImagePlanBindings.find(bindingLookup)');
    expect(recovery).toContain('extensionAiImageSuiteService.getCurrentByPlan');
    expect(recovery).toContain('readEnabled: Boolean(currentSuite)');
    expect(recovery).toContain('isExtensionHostedAiImageActiveDraftStage(authority.draftStage)');
    expect(recovery).not.toContain("authority.draftStage !== 'MEDIA_REVIEW'");

    const planRouteStart = source.indexOf('const extensionHostedAiImagePlanRouteService');
    const planRouteEnd = source.indexOf('const extensionHostedCandidatePreviewService', planRouteStart);
    const planRoute = source.slice(planRouteStart, planRouteEnd);
    expect(planRoute).toMatch(/create:[\s\S]*extensionHostedAiImagePlanService\.create/u);
    expect(planRoute).toMatch(/get:[\s\S]*extensionHostedAiImageReadPlanService\.get/u);
    expect(planRoute).toMatch(/getCurrent:[\s\S]*extensionHostedAiImageReadPlanService\.getCurrent/u);
    expect(planRoute).toMatch(/review:[\s\S]*extensionHostedAiImagePlanService\.review/u);
    expect(source).toContain('service: extensionHostedAiImagePlanRouteService');

    const previewStart = source.indexOf('const extensionHostedCandidatePreviewService');
    const previewEnd = source.indexOf('const extensionHostedListingAssignmentCore', previewStart);
    const preview = source.slice(previewStart, previewEnd);
    expect(preview).toContain('loadExtensionHostedAiImageReadPolicy');
    expect(preview).toContain('readPolicy.readEnabled');
    expect(preview).toContain('loadCandidateAuthority(input)');
  });

  it('loads suite state only through the exact persisted device and draft binding', () => {
    const start = source.indexOf('const loadExtensionAiImageSuiteState');
    const end = source.indexOf('const loadExtensionAiImageSuitePreviewOrigins', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const loader = source.slice(start, end);

    expect(loader).toContain('deviceSessionId: string');
    expect(loader).toContain('extensionHostedAiImageAuthority.loadPlanAuthority');
    expect(loader).toContain('extensionHostedAiImagePlanBindings.find(bindingLookup)');
    expect(loader).toContain('id: storedBinding.planId');
    expect(loader).toContain('deviceSessionId: input.deviceSessionId');
    expect(loader).toContain('loadExtensionHostedAiImageReadPolicy');
    expect(loader).toContain('!readPolicy.readEnabled');
    expect(loader).toContain('if (!readPolicy.writeEnabled)');
    expect(loader).toContain('executionReady: false');
    expect(loader).not.toMatch(/orderBy:\s*\[\{ updatedAt: 'desc' \}/u);
  });

  it('passes the authenticated device session through every suite authority reload', () => {
    const stateStart = source.indexOf('const loadExtensionAiImageSuiteState');
    const stateEnd = source.indexOf('const loadExtensionAiImageSuitePreviewOrigins', stateStart);
    const stateLoader = source.slice(stateStart, stateEnd);
    expect(stateLoader).toMatch(
      /const authority = \{\s*deviceSessionId: input\.deviceSessionId,[\s\S]*?\n\s*\};/u,
    );

    const projectionStart = source.indexOf('const loadExtensionAiImageSuiteProjection');
    const projectionEnd = source.indexOf('const extensionAiImageSuiteReferenceService', projectionStart);
    const projectionLoader = source.slice(projectionStart, projectionEnd);
    expect(projectionLoader).toContain('const state = await loadExtensionAiImageSuiteState(input);');

    const commandStart = source.indexOf('const extensionAiImageSuiteCommandLoaders');
    const commandEnd = source.indexOf('const assertExtensionAiImageSuiteWriteEnabled', commandStart);
    const commandLoaders = source.slice(commandStart, commandEnd);
    expect(commandLoaders.match(/loadExtensionAiImageSuiteState\(input\)/gu)).toHaveLength(1);
    expect(commandLoaders).toContain('...state.authority');
    expect(commandLoaders.match(/loadExtensionAiImageSuiteProjection\(input, scopes\)/gu)).toHaveLength(1);

    once(/createExtensionAiImageSuiteExecuteCommandExecutor\(\{\s*\.\.\.extensionAiImageSuiteCommandLoaders/gu);
    once(/createExtensionAiImageSuiteReviewCommandExecutor\(\{\s*\.\.\.extensionAiImageSuiteCommandLoaders/gu);
    once(/createExtensionAiImageSuiteApplyCommandExecutor\(\{\s*\.\.\.extensionAiImageSuiteCommandLoaders/gu);
    expect(source).toMatch(
      /assertExtensionAiImageSuiteWriteEnabled[\s\S]*evaluateExtensionHostedAiImagePolicy/gu,
    );
  });
});
