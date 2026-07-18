import { prisma } from '../lib/prisma.js';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import {
  createAiMediaPlanningService,
  type AiMediaPlanningRepository,
  type CreateRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';

export async function processRuleBasedAiMediaPlanning(
  input: CreateRuleBasedAiMediaPlanningInput,
  overrides: { repository?: AiMediaPlanningRepository } = {},
) {
  const repository = overrides.repository || new PrismaAiMediaPlanningRepository(prisma);
  return createAiMediaPlanningService(repository).createRuleBased(input);
}
