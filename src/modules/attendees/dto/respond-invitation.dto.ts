import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const INVITATION_RESPONSES = ['ACCEPTED', 'DECLINED'] as const;

export type InvitationResponseStatus = (typeof INVITATION_RESPONSES)[number];

export class RespondInvitationDto {
  @ApiProperty({ enum: INVITATION_RESPONSES })
  @IsIn(INVITATION_RESPONSES)
  status!: InvitationResponseStatus;
}
