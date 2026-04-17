import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ListConversationsQueryDto } from './dto/list-conversations.query';
import {
  ConversationDetailDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';

@ApiTags('Conversations')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

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

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation with full message thread' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationDetailDto> {
    return this.conversationsService.findOne(id, user);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto[]> {
    return this.conversationsService.getMessages(id, user);
  }
}
