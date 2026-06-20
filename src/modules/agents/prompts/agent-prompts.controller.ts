import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgentRole } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERM } from '../../../common/auth/permission-keys';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { AgentPromptsService } from './agent-prompts.service';
import { UpdateAgentPromptDto } from './dto/update-agent-prompt.dto';
import { AgentPromptResponseDto } from './dto/agent-prompt-response.dto';

class CompanyScopeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

const VALID_ROLES = new Set<AgentRole>(Object.values(AgentRole));

@ApiTags('Agent Prompts')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agent-prompts')
export class AgentPromptsController {
  constructor(private readonly agentPrompts: AgentPromptsService) {}

  @RequirePermissions(PERM.platformAgentsView)
  @Get()
  @ApiOperation({
    summary:
      'List all 5 role prompts for the active AgentConfig. Missing roles are filled with read-only default placeholders; the first update persists a real row.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyScopeQueryDto,
  ): Promise<AgentPromptResponseDto[]> {
    return this.agentPrompts.listForCompany(user, query.companyId);
  }

  @RequirePermissions(PERM.platformAgentsManage)
  @Put(':role')
  @ApiOperation({
    summary:
      'Update (or auto-create on first write) the prompt for a single role. Role is one of ANALYZER | RETRIEVER | DECIDER | EXECUTOR | RESPONDER.',
  })
  update(
    @Param('role') rawRole: string,
    @Body() dto: UpdateAgentPromptDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyScopeQueryDto,
  ): Promise<AgentPromptResponseDto> {
    const role = parseRole(rawRole);
    return this.agentPrompts.updateRole(role, dto, user, query.companyId);
  }
}

function parseRole(raw: string): AgentRole {
  const upper = raw.toUpperCase();
  if (!VALID_ROLES.has(upper as AgentRole)) {
    throw new BadRequestException(
      `Unknown agent role '${raw}'. Expected one of: ${Object.values(AgentRole).join(', ')}.`,
    );
  }
  return upper as AgentRole;
}
