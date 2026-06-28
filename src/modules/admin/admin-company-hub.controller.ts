import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AgentConfigService } from '../agents/config/agent-config.service';
import { AgentKbService } from '../agents/knowledge-base/agent-kb.service';
import { UpdateAgentConfigDto } from '../agents/config/dto/update-agent-config.dto';
import { AgentConfigResponseDto } from '../agents/config/dto/agent-config-response.dto';
import { CreateAgentKbDto } from '../agents/knowledge-base/dto/create-agent-kb.dto';
import { UpdateAgentKbDto } from '../agents/knowledge-base/dto/update-agent-kb.dto';
import { AgentKbResponseDto } from '../agents/knowledge-base/dto/agent-kb-response.dto';
import { PrismaService } from '../../prisma/prisma.service';

const KB_ID_REGEX = /^[a-z0-9_-]{8,40}$/i;

function assertKbId(raw: string): string {
  if (!KB_ID_REGEX.test(raw)) {
    throw new BadRequestException('Invalid KB id');
  }
  return raw;
}

@ApiTags('Admin · Company hub (agent & KB)')
@ApiCookieAuth('access_token')
@Controller('admin/companies/:companyId')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminCompanyHubController {
  constructor(
    private readonly agentConfig: AgentConfigService,
    private readonly kb: AgentKbService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get('agent-config')
  @ApiOperation({ summary: 'Get active agent config for a company' })
  getAgentConfig(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentConfigResponseDto> {
    return this.agentConfig.getActive(user, companyId);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put('agent-config')
  @ApiOperation({ summary: 'Update agent config for a company' })
  updateAgentConfig(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateAgentConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentConfigResponseDto> {
    return this.agentConfig.update(dto, user, companyId);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get('knowledge-base')
  @ApiOperation({ summary: 'List knowledge base entries for a company' })
  listKnowledgeBase(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kb.list({ companyId, limit: 200 }, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('knowledge-base')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a knowledge base entry' })
  createKnowledgeBase(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateAgentKbDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.create({ ...dto, companyId }, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put('knowledge-base/:entryId')
  @ApiOperation({ summary: 'Update a knowledge base entry' })
  updateKnowledgeBase(
    @Param('entryId') entryId: string,
    @Body() dto: UpdateAgentKbDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    return this.kb.update(assertKbId(entryId), dto, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Delete('knowledge-base/:entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a knowledge base entry' })
  deleteKnowledgeBase(
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.kb.softDelete(assertKbId(entryId), user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get('users')
  @ApiOperation({ summary: 'List all users for a company' })
  async listUsers(@Param('companyId', ParseUUIDPipe) companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role_name: true,
        isActive: true,
        firstLoginCompleted: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      roleName: u.role_name,
      isActive: u.isActive,
      firstLoginCompleted: u.firstLoginCompleted,
      createdAt: u.createdAt,
    }));
  }
}
