import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCookieAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { WebsitesService } from './websites.service';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { WebsiteResponseDto } from './dto/website-response.dto';
import { WebsiteLiveCheckResponseDto } from './dto/website-live-check.response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Websites')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('websites')
export class WebsitesController {
  constructor(private readonly websitesService: WebsitesService) {}

  @RequirePermissions(PERM.companyWebsitesView)
  @Get()
  @ApiOperation({ summary: 'List websites — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto[]> {
    return this.websitesService.findAll(user);
  }

  @RequirePermissions(PERM.companyWebsitesView)
  @Get(':id/check-live')
  @ApiOperation({ summary: 'Check if a website URL is live and responding' })
  @ApiOkResponse({ type: WebsiteLiveCheckResponseDto })
  checkLive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteLiveCheckResponseDto> {
    return this.websitesService.checkLive(id, user);
  }

  @RequirePermissions(PERM.companyWebsitesView)
  @Get(':id')
  @ApiOperation({ summary: 'Get website by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.findOne(id, user);
  }

  @Roles('SUPER_ADMIN')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create website — SUPER_ADMIN only' })
  create(
    @Body() dto: CreateWebsiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.create(dto, user);
  }

  @Roles('SUPER_ADMIN')
  @Put(':id')
  @ApiOperation({ summary: 'Update website — SUPER_ADMIN only' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebsiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.update(id, dto, user);
  }

  @Roles('SUPER_ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete website — SUPER_ADMIN only' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.websitesService.remove(id, user);
  }
}
