import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { ConversationControlService } from './conversation-control.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantRoles } from '../../common/decorators/tenant-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ListConversationsQueryDto } from './dto/list-conversations.query';
import {
  ConversationDetailDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ConversationControlResponseDto } from './dto/control-response.dto';
import { SendHumanMessageDto } from './dto/send-human-message.dto';

@ApiTags('Conversations')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly controlService: ConversationControlService,
  ) {}

  @RequirePermissions(PERM.companyConversationsView)
  @Get()
  @ApiOperation({
    summary: 'List conversations — scoped to requester company',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationListItemDto[]> {
    return this.conversationsService.findAll(user, query);
  }

  @RequirePermissions(PERM.companyConversationsView)
  @Get(':id')
  @ApiOperation({ summary: 'Get conversation with full message thread' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyConversationsView)
  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto[]> {
    return this.conversationsService.getMessages(id, user);
  }

  @RequirePermissions(PERM.companyConversationsManage)
  @Post(':id/takeover')
  @TenantRoles()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take manual control of a conversation (AGENT → HUMAN)',
  })
  takeover(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationControlResponseDto> {
    return this.controlService.takeover(id, user);
  }

  @RequirePermissions(PERM.companyConversationsManage)
  @Post(':id/handback')
  @TenantRoles()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hand control back to the agent (HUMAN → AGENT)',
  })
  handback(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationControlResponseDto> {
    return this.controlService.handback(id, user);
  }

  @RequirePermissions(PERM.companyConversationsManage)
  @Post(':id/messages')
  @TenantRoles()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Send a human outbound message (requires HUMAN mode controlled by requester)',
  })
  sendHumanMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendHumanMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.controlService.sendHumanMessage(id, dto.content, user);
  }
}
