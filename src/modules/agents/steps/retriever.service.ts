import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AgentsConfig } from '../../../config/configuration';
import type {
  AnalyzerOutput,
  PipelineContext,
  RetrievedKbEntry,
  RetrievedMessage,
  RetrievedProduct,
  RetrievedStaff,
  RetrieverOutput,
} from '../pipeline/pipeline-types';

export interface RetrieverStepInput {
  context: PipelineContext;
  analysis: AnalyzerOutput;
}

export interface RetrieverStepResult {
  input: {
    entities: AnalyzerOutput['entities'];
    messageWindow: number;
  };
  output: RetrieverOutput;
}

/** Per-step row caps to keep token payloads bounded. */
const MAX_KB = 5;
const MAX_PRODUCTS = 8;
const MAX_STAFF = 10;

/**
 * Deterministic data-gathering step. No LLM call. We keep scopes tight to
 * avoid large payloads leaking into Groq prompts:
 *  - KB: full-text ILIKE on title/content filtered by analyzer-detected
 *    keywords. Falls back to recent top-N when no keywords matched.
 *  - Products: name ILIKE on analyzed product entities; otherwise top active.
 *  - Staff: name ILIKE on analyzed staff entities; no fallback (optional context).
 *  - Messages: last N messages of the conversation (bounded window).
 */
@Injectable()
export class RetrieverService {
  private readonly messageWindow: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.messageWindow = config.getOrThrow<AgentsConfig>(
      'agents',
    ).retrieverMessageWindow;
  }

  async run(input: RetrieverStepInput): Promise<RetrieverStepResult> {
    const { companyId, conversationId } = input.context;
    const { entities } = input.analysis;

    const kbKeywords = this.toKeywords([
      ...entities.products,
      ...entities.names,
      input.analysis.summary,
    ]);

    const [knowledgeBase, products, staff, recentMessages] = await Promise.all([
      this.fetchKnowledgeBase(companyId, kbKeywords),
      this.fetchProducts(companyId, entities.products),
      this.fetchStaff(companyId, entities.staff),
      this.fetchRecentMessages(conversationId),
    ]);

    return {
      input: {
        entities,
        messageWindow: this.messageWindow,
      },
      output: {
        knowledgeBase,
        products,
        staff,
        recentMessages,
      },
    };
  }

  private toKeywords(values: string[]): string[] {
    return values
      .map((v) => v.trim())
      .filter((v) => v.length >= 3)
      .slice(0, 5);
  }

  private async fetchKnowledgeBase(
    companyId: string,
    keywords: string[],
  ): Promise<RetrievedKbEntry[]> {
    const baseWhere: Prisma.AgentKnowledgeBaseWhereInput = {
      companyId,
      isActive: true,
    };
    const where: Prisma.AgentKnowledgeBaseWhereInput =
      keywords.length === 0
        ? baseWhere
        : {
            ...baseWhere,
            OR: keywords.flatMap((kw) => [
              { title: { contains: kw, mode: Prisma.QueryMode.insensitive } },
              { content: { contains: kw, mode: Prisma.QueryMode.insensitive } },
            ]),
          };

    const rows = await this.prisma.agentKnowledgeBase.findMany({
      where,
      select: { id: true, title: true, content: true, category: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_KB,
    });
    return rows;
  }

  private async fetchProducts(
    companyId: string,
    mentioned: string[],
  ): Promise<RetrievedProduct[]> {
    const baseWhere: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
    };
    const where: Prisma.ProductWhereInput =
      mentioned.length === 0
        ? baseWhere
        : {
            ...baseWhere,
            OR: mentioned.map((name) => ({
              name: { contains: name, mode: Prisma.QueryMode.insensitive },
            })),
          };

    const rows = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        price: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PRODUCTS,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      price: r.price.toString(),
    }));
  }

  private async fetchStaff(
    companyId: string,
    mentioned: string[],
  ): Promise<RetrievedStaff[]> {
    if (mentioned.length === 0) return [];
    const rows = await this.prisma.staff.findMany({
      where: {
        companyId,
        isActive: true,
        OR: mentioned.flatMap((name) => [
          { firstName: { contains: name, mode: Prisma.QueryMode.insensitive } },
          { lastName: { contains: name, mode: Prisma.QueryMode.insensitive } },
        ]),
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      take: MAX_STAFF,
    });
    return rows;
  }

  private async fetchRecentMessages(
    conversationId: string,
  ): Promise<RetrievedMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'desc' },
      take: this.messageWindow,
      select: { senderType: true, content: true, sentAt: true },
    });
    return rows
      .reverse()
      .map((r) => ({
        senderType: r.senderType,
        content: r.content,
        sentAt: r.sentAt.toISOString(),
      }));
  }
}
