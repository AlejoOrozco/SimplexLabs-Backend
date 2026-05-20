import { ApiProperty } from '@nestjs/swagger';

export class WebsiteLiveCheckResponseDto {
  @ApiProperty()
  isLive!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  statusCode!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  responseTimeMs!: number | null;

  @ApiProperty({ example: '2026-05-13T12:00:00.000Z' })
  checkedAt!: string;
}
