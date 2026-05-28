import { Prisma, SenderType } from '@prisma/client';
import {
  ConversationDetailDto,
  ConversationListItemDto,
  LastMessagePreviewDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} satisfies Prisma.ClientContactSelect;

const lastMessageSelect = {
  content: true,
  sentAt: true,
  senderType: true,
} satisfies Prisma.MessageSelect;

export const listConversationInclude = {
  contact: { select: contactSelect },
  messages: {
    orderBy: { sentAt: 'desc' as const },
    take: 1,
    select: lastMessageSelect,
  },
  _count: {
    select: {
      messages: {
        where: {
          senderType: SenderType.CONTACT,
          deliveredAt: null,
        },
      },
    },
  },
} satisfies Prisma.ConversationInclude;

export const detailConversationInclude = {
  contact: { select: contactSelect },
  messages: {
    orderBy: { sentAt: 'asc' as const },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationListRow = Prisma.ConversationGetPayload<{
  include: typeof listConversationInclude;
}>;

export type ConversationDetailRow = Prisma.ConversationGetPayload<{
  include: typeof detailConversationInclude;
}>;

type MessageRow = ConversationDetailRow['messages'][number];

const messageListSelect = {
  id: true,
  senderType: true,
  content: true,
  sentAt: true,
  deliveredAt: true,
  metadata: true,
  conversationId: true,
} satisfies Prisma.MessageSelect;

export type MessageListRow = Prisma.MessageGetPayload<{
  select: typeof messageListSelect;
}>;

export { messageListSelect };

export function toMessageResponse(message: MessageRow | MessageListRow): MessageResponseDto {
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

function toLastMessagePreview(
  message: ConversationListRow['messages'][number],
): LastMessagePreviewDto {
  return {
    content: message.content,
    sentAt: message.sentAt,
    senderType: message.senderType,
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
    lastMessage: latest ? toLastMessagePreview(latest) : null,
    unreadCount: row._count.messages,
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
