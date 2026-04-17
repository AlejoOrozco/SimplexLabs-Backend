import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Channel, ConvoStatus } from '@prisma/client';

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ enum: Channel })
  @IsEnum(Channel)
  @IsOptional()
  channel?: Channel;

  @ApiPropertyOptional({ enum: ConvoStatus })
  @IsEnum(ConvoStatus)
  @IsOptional()
  status?: ConvoStatus;
}
