import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import { ListConversationsQueryDto } from './dto/list-conversations.query';
import {
  ConversationDetailDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import {
  detailConversationInclude,
  listConversationInclude,
  toConversationDetail,
  toConversationListItem,
  toMessageResponse,
} from './conversation.mapper';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    requester: AuthenticatedUser,
    filters: ListConversationsQueryDto,
  ): Promise<ConversationListItemDto[]> {
    const where: Prisma.ConversationWhereInput = {
      ...scopedCompanyWhere(requester),
      ...(filters.channel !== undefined && { channel: filters.channel }),
      ...(filters.status !== undefined && { status: filters.status }),
    };

    const rows = await this.prisma.conversation.findMany({
      where,
      include: listConversationInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toConversationListItem);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<ConversationDetailDto> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: detailConversationInclude,
    });
    if (!row) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return toConversationDetail(row);
  }

  async getMessages(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<MessageResponseDto[]> {
    await this.assertConversationAccess(id, requester);

    const rows = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { sentAt: 'asc' },
    });
    return rows.map(toMessageResponse);
  }

  /**
   * Cheap access check that only loads the tenant key — avoids the full
   * include graph when the caller only needs authorization.
   */
  private async assertConversationAccess(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<void> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!row) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
  }
}
