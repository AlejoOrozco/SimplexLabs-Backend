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
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { WebsitesService } from './websites.service';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { WebsiteResponseDto } from './dto/website-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Websites')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('websites')
export class WebsitesController {
  constructor(private readonly websitesService: WebsitesService) {}

  @Get()
  @ApiOperation({ summary: 'List websites — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto[]> {
    return this.websitesService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get website by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.findOne(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create website' })
  create(
    @Body() dto: CreateWebsiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.create(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update website' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebsiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    return this.websitesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete website' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.websitesService.remove(id, user);
  }
}
