import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { AgentConfigService } from './agent-config.service';
import { UpdateAgentConfigDto } from './dto/update-agent-config.dto';
import { AgentConfigResponseDto } from './dto/agent-config-response.dto';

class CompanyScopeQueryDto {
  @ApiPropertyOptional({
    description:
      'Required when the caller is SUPER_ADMIN (explicit tenant selection). Ignored for CLIENT callers.',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

@ApiTags('Agent Config')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agent-config')
export class AgentConfigController {
  constructor(private readonly agentConfig: AgentConfigService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({
    summary:
      "Get the active AgentConfig for the requester's company (lazy-seeds defaults if missing).",
  })
  getActive(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyScopeQueryDto,
  ): Promise<AgentConfigResponseDto> {
    return this.agentConfig.getActive(user, query.companyId);
  }

  @Put()
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({
    summary:
      'Update the active AgentConfig (PATCH semantics over PUT; every field is optional).',
  })
  update(
    @Body() dto: UpdateAgentConfigDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyScopeQueryDto,
  ): Promise<AgentConfigResponseDto> {
    return this.agentConfig.update(dto, user, query.companyId);
  }
}
