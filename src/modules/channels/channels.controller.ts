import {
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
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Manage per-company channel credentials (WhatsApp / IG / Messenger).
 *
 * Only `CLIENT` (tenant owner) and `SUPER_ADMIN` can reach this endpoint.
 * Tenant scoping is enforced in the service layer; the role guard here
 * is the coarse outer ring (any authenticated user with a company could
 * otherwise read or mutate credentials).
 */
@ApiTags('Channels')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPER_ADMIN', 'CLIENT')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @RequirePermissions(PERM.companyChannelsView)
  @Get()
  @ApiOperation({ summary: 'List channels — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelResponseDto[]> {
    return this.channelsService.findAll(user);
  }

  @RequirePermissions(PERM.companyChannelsView)
  @Get(':id')
  @ApiOperation({ summary: 'Get channel by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    return this.channelsService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyChannelsManage)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Register a channel and store its provider access token (encrypted)',
  })
  create(
    @Body() dto: CreateChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    return this.channelsService.create(dto, user);
  }

  @RequirePermissions(PERM.companyChannelsManage)
  @Put(':id')
  @ApiOperation({
    summary: 'Update channel metadata or rotate the access token',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    return this.channelsService.update(id, dto, user);
  }

  @RequirePermissions(PERM.companyChannelsManage)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate (soft-delete) a channel' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.channelsService.remove(id, user);
  }
}
