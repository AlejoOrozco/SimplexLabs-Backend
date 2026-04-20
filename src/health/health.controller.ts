import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Returns 200 when the HTTP server is up' })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
