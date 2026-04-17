import { ApiProperty } from '@nestjs/swagger';
import type { Channel, ConvoStatus } from '@prisma/client';
import { MessageResponseDto } from './message-response.dto';

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
  @ApiProperty({ type: MessageResponseDto, nullable: true })
  lastMessage!: MessageResponseDto | null;
}

export class ConversationDetailDto extends ConversationBaseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  messages!: MessageResponseDto[];
}
