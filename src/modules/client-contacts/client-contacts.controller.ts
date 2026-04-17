import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { ClientContactsService } from './client-contacts.service';
import { CreateClientContactDto } from './dto/create-client-contact.dto';
import { UpdateClientContactDto } from './dto/update-client-contact.dto';
import { ClientContactResponseDto } from './dto/client-contact-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('ClientContacts')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('client-contacts')
export class ClientContactsController {
  constructor(private readonly clientContactsService: ClientContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List contacts — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClientContactResponseDto[]> {
    return this.clientContactsService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    return this.clientContactsService.findOne(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create contact' })
  create(
    @Body() dto: CreateClientContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    return this.clientContactsService.create(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update contact' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    return this.clientContactsService.update(id, dto, user);
  }
}
