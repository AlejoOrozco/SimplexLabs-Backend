import { ApiProperty } from '@nestjs/swagger';
import type { Channel, ConvoStatus, SenderType } from '@prisma/client';
import { MessageResponseDto } from './message-response.dto';

/** Latest message preview for inbox list rows. */
export class LastMessagePreviewDto {
  @ApiProperty()
  content!: string;

  @ApiProperty()
  sentAt!: Date;

  @ApiProperty({ enum: ['AGENT', 'CONTACT', 'HUMAN'] })
  senderType!: SenderType;
}

export class ConversationContactSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

class ConversationBaseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  contactId!: string;

  @ApiProperty({ enum: ['WHATSAPP', 'INSTAGRAM', 'MESSENGER'] })
  channel!: Channel;

  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'PENDING'] })
  status!: ConvoStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: ConversationContactSummaryDto })
  contact!: ConversationContactSummaryDto;
}

export class ConversationListItemDto extends ConversationBaseDto {
  @ApiProperty({ type: LastMessagePreviewDto, nullable: true })
  lastMessage!: LastMessagePreviewDto | null;

  @ApiProperty({
    description:
      'Inbound messages not yet marked delivered (contact sender, deliveredAt null)',
  })
  unreadCount!: number;
}

export class ConversationDetailDto extends ConversationBaseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  messages!: MessageResponseDto[];
}
