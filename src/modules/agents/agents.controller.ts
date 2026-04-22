import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { AgentRunResponseDto } from './dto/agent-run-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('Agents')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get('runs/conversation/:conversationId')
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({
    summary: 'List AgentRuns for a conversation (tenant-scoped, newest first)',
  })
  listRunsForConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentRunResponseDto[]> {
    return this.agentsService.listRunsForConversation(conversationId, user, {
      limit,
    });
  }

  @Get('runs/failed')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'List recent failed AgentRuns across all tenants (admin only)',
  })
  listRecentFailedRuns(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentRunResponseDto[]> {
    return this.agentsService.listRecentFailedRuns(user, { limit });
  }
}
