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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions(PERM.companyUsersView)
  @Get()
  @ApiOperation({
    summary: 'List users — admins see all, clients see their own company',
  })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto[]> {
    return this.usersService.findAll(user);
  }

  @RequirePermissions(PERM.companyUsersView)
  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyUsersManage)
  @Post()
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create user — admin only' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.create(dto, user);
  }

  @RequirePermissions(PERM.companyUsersManage)
  @Put(':id')
  @ApiOperation({ summary: 'Update user' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto, user);
  }

  @RequirePermissions(PERM.companyUsersManage)
  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user — admin only' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.usersService.remove(id, user);
  }

  @RequirePermissions(PERM.companyUsersManage)
  @Put('me/complete-first-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark first login tour as completed' })
  completeFirstLogin(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.completeFirstLogin(user.id);
  }
}
