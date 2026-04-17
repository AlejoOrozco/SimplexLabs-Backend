import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { RawResponse } from '../../common/decorators/raw-response.decorator';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('meta')
  @RawResponse()
  @ApiOperation({ summary: 'Meta webhook verification challenge' })
  @ApiQuery({ name: 'hub.mode', required: true })
  @ApiQuery({ name: 'hub.verify_token', required: true })
  @ApiQuery({ name: 'hub.challenge', required: true })
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const result = this.webhooksService.verifyWebhook(mode, token, challenge);
    if (!result) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return result;
  }

  @Post('meta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Meta webhook events' })
  receive(@Body() payload: unknown): { received: boolean } {
    this.webhooksService.handleMetaEvent(payload);
    return { received: true };
  }
}
