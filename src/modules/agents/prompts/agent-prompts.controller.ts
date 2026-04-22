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
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agent-prompts')
export class AgentPromptsController {
  constructor(private readonly agentPrompts: AgentPromptsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CLIENT')
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

  @Put(':role')
  @Roles('SUPER_ADMIN', 'CLIENT')
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
