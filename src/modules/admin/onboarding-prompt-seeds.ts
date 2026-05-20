import { AgentRole, Prisma } from '@prisma/client';
import { DEFAULT_PROMPTS } from '../agents/prompts/default-prompts';

/**
 * Seeds the five pipeline roles (ANALYZER, RETRIEVER, DECIDER, EXECUTOR,
 * RESPONDER) using the canonical defaults, with light business context
 * injected for ANALYZER and RESPONDER.
 */
export function buildOnboardingAgentPromptCreates(
  agentName: string,
  companyName: string,
): Prisma.AgentPromptCreateWithoutAgentConfigInput[] {
  return DEFAULT_PROMPTS.map((p) => {
    let systemPrompt = p.systemPrompt;
    if (p.role === AgentRole.RESPONDER) {
      systemPrompt = `${p.systemPrompt}\n\nAssistant display name: "${agentName}". Business name: "${companyName}".`;
    }
    if (p.role === AgentRole.ANALYZER) {
      systemPrompt = `Business name: "${companyName}". Assistant name for customers: "${agentName}".\n\n${p.systemPrompt}`;
    }
    return {
      role: p.role,
      systemPrompt,
      model: p.model,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      isActive: true,
    };
  });
}
