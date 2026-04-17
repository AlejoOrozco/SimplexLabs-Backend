import { Prisma } from '@prisma/client';
import {
  ConversationDetailDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} satisfies Prisma.ClientContactSelect;

export const listConversationInclude = {
  contact: { select: contactSelect },
  messages: {
    orderBy: { sentAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ConversationInclude;

export const detailConversationInclude = {
  contact: { select: contactSelect },
  messages: {
    orderBy: { sentAt: 'asc' },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationListRow = Prisma.ConversationGetPayload<{
  include: typeof listConversationInclude;
}>;

export type ConversationDetailRow = Prisma.ConversationGetPayload<{
  include: typeof detailConversationInclude;
}>;

type MessageRow = ConversationDetailRow['messages'][number];

export function toMessageResponse(message: MessageRow): MessageResponseDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType,
    content: message.content,
    metadata: message.metadata,
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
  };
}

export function toConversationListItem(
  row: ConversationListRow,
): ConversationListItemDto {
  const [latest] = row.messages;
  return {
    id: row.id,
    companyId: row.companyId,
    contactId: row.contactId,
    channel: row.channel,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contact: { ...row.contact },
    lastMessage: latest ? toMessageResponse(latest) : null,
  };
}

export function toConversationDetail(
  row: ConversationDetailRow,
): ConversationDetailDto {
  return {
    id: row.id,
    companyId: row.companyId,
    contactId: row.contactId,
    channel: row.channel,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contact: { ...row.contact },
    messages: row.messages.map(toMessageResponse),
  };
}
