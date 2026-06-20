import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERM } from '../../../common/auth/permission-keys';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { AgentKbService, type AgentKbListResult } from './agent-kb.service';
import { AgentKbResponseDto } from './dto/agent-kb-response.dto';
import { CreateAgentKbDto } from './dto/create-agent-kb.dto';
import { UpdateAgentKbDto } from './dto/update-agent-kb.dto';
import { ListAgentKbQueryDto } from './dto/list-agent-kb-query.dto';

/**
 * `AgentKnowledgeBase.id` is a cuid (not a UUID) so we can't use
 * `ParseUUIDPipe` here. We still sanity-check the shape to reject
 * obvious garbage before hitting the DB.
 */
const ID_REGEX = /^[a-z0-9_-]{8,40}$/i;
function assertId(raw: string): string {
  if (!ID_REGEX.test(raw)) {
    throw new BadRequestException('Invalid KB id');
  }
  return raw;
}

@ApiTags('Agent Knowledge Base')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agent-kb')
export class AgentKbController {
  constructor(private readonly kb: AgentKbService) {}

  @RequirePermissions(PERM.platformAgentsView)
  @Get()
  @ApiOperation({
    summary:
      'List KB entries. Supports `category`, `isActive`, and `search` (title/content).',
  })
  list(
    @Query() query: ListAgentKbQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbListResult> {
    return this.kb.list(query, user);
  }

  @RequirePermissions(PERM.platformAgentsView)
  @Get(':id')
  @ApiOperation({ summary: 'Get a KB entry by id (tenant-scoped).' })
  findOne(
    @Param('id') rawId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.findOne(assertId(rawId), user);
  }

  @RequirePermissions(PERM.platformAgentsManage)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a KB entry.' })
  create(
    @Body() dto: CreateAgentKbDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.create(dto, user);
  }

  @RequirePermissions(PERM.platformAgentsManage)
  @Put(':id')
  @ApiOperation({
    summary:
      'Update a KB entry (title / content / category / isActive). PATCH semantics over PUT.',
  })
  update(
    @Param('id') rawId: string,
    @Body() dto: UpdateAgentKbDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.update(assertId(rawId), dto, user);
  }

  @RequirePermissions(PERM.platformAgentsManage)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Soft-delete (deactivate) a KB entry. Idempotent. Use POST :id/reactivate to restore.',
  })
  softDelete(
    @Param('id') rawId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.kb.softDelete(assertId(rawId), user);
  }

  @RequirePermissions(PERM.platformAgentsManage)
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a soft-deleted KB entry.' })
  reactivate(
    @Param('id') rawId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.reactivate(assertId(rawId), user);
  }
}
