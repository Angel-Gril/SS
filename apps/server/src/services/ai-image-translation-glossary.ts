import { createHash } from 'node:crypto';
import { z } from 'zod';

export const AI_IMAGE_TRANSLATION_GLOSSARY_DEFAULT_JSON = '{"version":1,"profiles":[]}';
export const AI_IMAGE_TRANSLATION_GLOSSARY_MAX_TERMS = 50;
export const AI_IMAGE_TRANSLATION_GLOSSARY_MAX_CONFIG_CHARS = 100_000;
export const AI_IMAGE_TRANSLATION_GLOSSARY_MAX_PROFILES = 500;

const normalizedTextSchema = z.string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(z.string().min(1));

const languageSchema = normalizedTextSchema
  .pipe(z.string().regex(/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/iu))
  .transform((value) => value.toLowerCase());
const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const trustedCategorySchema = z.object({
  categoryId: positiveIntegerSchema,
  typeId: positiveIntegerSchema,
});

const termSchema = z.object({
  src: normalizedTextSchema.pipe(z.string().max(120)),
  tgt: normalizedTextSchema.pipe(z.string().max(120)),
}).strict();

const profileSchema = z.object({
  sourceLanguage: languageSchema,
  targetLanguage: languageSchema,
  categoryId: positiveIntegerSchema.optional(),
  typeId: positiveIntegerSchema.optional(),
  terms: z.array(termSchema).max(AI_IMAGE_TRANSLATION_GLOSSARY_MAX_TERMS),
}).strict().superRefine((profile, context) => {
  if (profile.sourceLanguage === profile.targetLanguage) {
    context.addIssue({
      code: 'custom',
      message: 'sourceLanguage and targetLanguage must differ',
      path: ['targetLanguage'],
    });
  }
  if (profile.typeId !== undefined && profile.categoryId === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'typeId requires categoryId',
      path: ['typeId'],
    });
  }

  const targetsBySource = new Map<string, string>();
  profile.terms.forEach((term, index) => {
    const sourceKey = term.src.toLowerCase();
    const previousTarget = targetsBySource.get(sourceKey);
    if (previousTarget !== undefined && previousTarget !== term.tgt) {
      context.addIssue({
        code: 'custom',
        message: `Conflicting source mapping for "${term.src}"`,
        path: ['terms', index, 'src'],
      });
    } else {
      targetsBySource.set(sourceKey, term.tgt);
    }
  });
});

const configSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema).max(AI_IMAGE_TRANSLATION_GLOSSARY_MAX_PROFILES),
}).strict().superRefine((config, context) => {
  const profileIndexesByKey = new Map<string, number>();
  config.profiles.forEach((profile, index) => {
    const key = profileKey(profile);
    if (profileIndexesByKey.has(key)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate profile key "${key}"`,
        path: ['profiles', index],
      });
    } else {
      profileIndexesByKey.set(key, index);
    }
  });
});

export type AiImageTranslationGlossaryTerm = z.infer<typeof termSchema>;
export type AiImageTranslationGlossaryProfile = z.infer<typeof profileSchema>;
export type AiImageTranslationGlossaryConfig = z.infer<typeof configSchema>;

export interface ResolveAiImageTranslationGlossaryInput {
  config: unknown;
  sourceLanguage: string;
  targetLanguage: string;
  categoryId?: number;
  typeId?: number;
  explicitTerms?: unknown;
}

export interface ResolvedAiImageTranslationGlossary {
  terms: AiImageTranslationGlossaryTerm[];
  matchedProfileKeys: string[];
  configVersion: 1;
  configSha256: string;
}

export function resolveTrustedAiImageTranslationCategory(input: {
  category?: { categoryId?: unknown; typeId?: unknown } | null;
  freshness?: { category?: { state?: unknown } | null } | null;
}): { categoryId: number; typeId: number } | null {
  if (input.freshness?.category?.state !== 'CURRENT') return null;
  const parsed = trustedCategorySchema.safeParse(input.category);
  return parsed.success ? parsed.data : null;
}

function normalizedSourceKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function profileKey(profile: Omit<AiImageTranslationGlossaryProfile, 'terms'>): string {
  const languagePair = `${profile.sourceLanguage}->${profile.targetLanguage}`;
  if (profile.typeId !== undefined) {
    return `${languagePair}:category:${profile.categoryId}:type:${profile.typeId}`;
  }
  if (profile.categoryId !== undefined) {
    return `${languagePair}:category:${profile.categoryId}`;
  }
  return `${languagePair}:global`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalConfigJson(config: AiImageTranslationGlossaryConfig): string {
  const profiles = config.profiles.map((profile) => ({
    ...profile,
    terms: [...profile.terms].sort((left, right) => (
      compareStrings(normalizedSourceKey(left.src), normalizedSourceKey(right.src))
      || compareStrings(left.tgt, right.tgt)
      || compareStrings(left.src, right.src)
    )),
  })).sort((left, right) => compareStrings(profileKey(left), profileKey(right)));

  return JSON.stringify({ version: config.version, profiles });
}

function configSha256(config: AiImageTranslationGlossaryConfig): string {
  return createHash('sha256').update(canonicalConfigJson(config)).digest('hex');
}

export function parseAiImageTranslationGlossary(raw: unknown): AiImageTranslationGlossaryConfig {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return configSchema.parse(JSON.parse(AI_IMAGE_TRANSLATION_GLOSSARY_DEFAULT_JSON));
  }

  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return configSchema.parse(value);
}

export function resolveAiImageTranslationGlossary(
  input: ResolveAiImageTranslationGlossaryInput,
): ResolvedAiImageTranslationGlossary {
  const config = parseAiImageTranslationGlossary(input.config);
  const sourceLanguage = languageSchema.parse(input.sourceLanguage);
  const targetLanguage = languageSchema.parse(input.targetLanguage);
  const categoryId = input.categoryId === undefined
    ? undefined
    : positiveIntegerSchema.parse(input.categoryId);
  const typeId = input.typeId === undefined
    ? undefined
    : positiveIntegerSchema.parse(input.typeId);

  if (typeId !== undefined && categoryId === undefined) {
    throw new TypeError('typeId requires categoryId');
  }

  const wantedKeys = [
    `${sourceLanguage}->${targetLanguage}:global`,
    ...(categoryId === undefined
      ? []
      : [`${sourceLanguage}->${targetLanguage}:category:${categoryId}`]),
    ...(categoryId === undefined || typeId === undefined
      ? []
      : [`${sourceLanguage}->${targetLanguage}:category:${categoryId}:type:${typeId}`]),
  ];
  const profilesByKey = new Map(config.profiles.map((profile) => [profileKey(profile), profile]));
  const termsBySource = new Map<string, AiImageTranslationGlossaryTerm>();
  const matchedProfileKeys: string[] = [];

  for (const key of wantedKeys) {
    const profile = profilesByKey.get(key);
    if (!profile) continue;
    matchedProfileKeys.push(key);
    for (const term of profile.terms) termsBySource.set(normalizedSourceKey(term.src), term);
  }

  const explicitTerms = input.explicitTerms === undefined
    ? []
    : z.array(termSchema).max(AI_IMAGE_TRANSLATION_GLOSSARY_MAX_TERMS).parse(input.explicitTerms);
  const explicitTargetsBySource = new Map<string, string>();
  for (const term of explicitTerms) {
    const sourceKey = normalizedSourceKey(term.src);
    const previousTarget = explicitTargetsBySource.get(sourceKey);
    if (previousTarget !== undefined && previousTarget !== term.tgt) {
      throw new TypeError(`Conflicting source mapping for "${term.src}"`);
    }
    explicitTargetsBySource.set(sourceKey, term.tgt);
    termsBySource.set(sourceKey, term);
  }

  const terms = [...termsBySource.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, term]) => term);

  if (terms.length > AI_IMAGE_TRANSLATION_GLOSSARY_MAX_TERMS) {
    throw new RangeError(`Resolved glossary exceeds ${AI_IMAGE_TRANSLATION_GLOSSARY_MAX_TERMS} terms`);
  }

  return {
    terms,
    matchedProfileKeys,
    configVersion: config.version,
    configSha256: configSha256(config),
  };
}

export const aiImageTranslationGlossaryStringSchema = z.string()
  .max(AI_IMAGE_TRANSLATION_GLOSSARY_MAX_CONFIG_CHARS)
  .superRefine((value, context) => {
    try {
      parseAiImageTranslationGlossary(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid AI image translation glossary',
      });
    }
  });
