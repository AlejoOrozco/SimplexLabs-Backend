import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { WebhooksService } from './webhooks.service';
import { MetaSignatureGuard } from './meta-signature.guard';

/**
 * Meta webhook endpoints. These do NOT go through the standard
 * `ResponseInterceptor` envelope because Meta requires:
 *   - GET /meta  →  status 200 with the raw `hub.challenge` plain-text body
 *   - POST /meta →  status 200 with an empty / plain body, always, within 5s
 *
 * Both handlers are decorated with `@RawResponse()` to skip the
 * `{ success, data, timestamp }` wrapper, and the GET handler uses
 * `@Res()` directly so the response type and status code are under our
 * full control (no passthrough).
 */
@ApiTags('Webhooks')
@Controller('webhooks')
// Meta retries a non-2xx aggressively; any per-IP rate limit on the
// provider's egress IPs would cause dropped deliveries. We rely on
// signature verification + dedupe for safety instead.
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('meta')
  @RawResponse()
  @ApiOperation({ summary: 'Meta webhook verification challenge' })
  @ApiExcludeEndpoint()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const result = this.webhooksService.verifyWebhook(mode, token, challenge);

    if (result === null) {
      this.logger.warn(
        `Meta verification rejected (mode=${mode ?? 'unset'}, token_present=${Boolean(token)})`,
      );
      res.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    res.status(HttpStatus.OK).type('text/plain').send(result);
  }

  @Post('meta')
  @UseGuards(MetaSignatureGuard)
  @RawResponse()
  @ApiOperation({ summary: 'Receive Meta webhook events' })
  @ApiExcludeEndpoint()
  receive(@Body() payload: unknown, @Res() res: Response): void {
    // Meta expects an acknowledgement within 5s or it will retry,
    // causing duplicate processing. We ACK first, then process in the
    // background. Any processing error is swallowed inside the service.
    res.status(HttpStatus.OK).send();

    void this.webhooksService.handleMetaEvent(payload).catch((error) => {
      this.logger.error(
        `Unhandled error in Meta webhook processing: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }
}
