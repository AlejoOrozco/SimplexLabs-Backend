import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCookieAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PlanCategory } from '@prisma/client';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanResponseDto } from './dto/plan-response.dto';
import {
  ListPlansQueryDto,
  PlansByCategoryQueryDto,
} from './dto/list-plans.query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({
    summary: 'List active plans — public; optional filters by category, niche, tier',
  })
  findAll(@Query() query: ListPlansQueryDto): Promise<PlanResponseDto[]> {
    return this.plansService.findAll({
      category: query.category,
      niche: query.niche,
      tier: query.tier,
    });
  }

  @Get('by-category/:category')
  @ApiOperation({
    summary: 'List active plans for a product category (all tiers), optional niche filter',
  })
  @ApiParam({
    name: 'category',
    enum: PlanCategory,
    description: 'Plan product category (MARKETING, WEBSITE, AI_AGENTS)',
  })
  findByCategory(
    @Param('category', new ParseEnumPipe(PlanCategory)) category: PlanCategory,
    @Query() query: PlansByCategoryQueryDto,
  ): Promise<PlanResponseDto[]> {
    return this.plansService.findByCategory(category, query.niche);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get plan by id — public' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PlanResponseDto> {
    return this.plansService.findOne(id);
  }

  @RequirePermissions(PERM.platformPlansManage)
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Create plan — admin only' })
  create(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.plansService.create(dto);
  }

  @RequirePermissions(PERM.platformPlansManage)
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('SUPER_ADMIN')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Update plan — admin only' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanResponseDto> {
    return this.plansService.update(id, dto);
  }

  @RequirePermissions(PERM.platformPlansManage)
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Soft-delete plan — admin only' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.plansService.remove(id);
  }
}
