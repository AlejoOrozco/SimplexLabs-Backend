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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Products')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @RequirePermissions(PERM.companyProductsView)
  @Get()
  @ApiOperation({ summary: 'List products — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(user);
  }

  @RequirePermissions(PERM.companyProductsView)
  @Get(':id')
  @ApiOperation({ summary: 'Get product by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    return this.productsService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyProductsManage)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product' })
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(dto, user);
  }

  @RequirePermissions(PERM.companyProductsManage)
  @Put(':id')
  @ApiOperation({ summary: 'Update product' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, dto, user);
  }

  @RequirePermissions(PERM.companyProductsManage)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete product' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.productsService.remove(id, user);
  }
}
