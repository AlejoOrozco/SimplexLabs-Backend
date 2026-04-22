import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { SandboxService } from './sandbox.service';
import { SandboxRunDto } from './dto/sandbox-run.dto';
import { SandboxRunResponseDto } from './dto/sandbox-run-response.dto';

@ApiTags('Agent Sandbox')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agent-sandbox')
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({
    summary:
      'Dry-run the 5-step agent pipeline against the company\'s live config + KB. No WhatsApp is sent; no appointments, orders, payments, notifications, or lifecycle transitions are persisted.',
  })
  run(
    @Body() dto: SandboxRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SandboxRunResponseDto> {
    return this.sandbox.run(dto, user);
  }
}
