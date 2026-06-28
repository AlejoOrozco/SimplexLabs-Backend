import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { PlansService } from '../plans/plans.service';
import { PlanResponseDto } from '../plans/dto/plan-response.dto';
import { AdminListPlansQueryDto } from '../plans/dto/admin-list-plans.query.dto';

@ApiTags('Admin · Plans')
@ApiCookieAuth('access_token')
@Controller('admin/plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminPlansController {
  constructor(private readonly plansService: PlansService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get()
  @ApiOperation({
    summary: 'List all plans including inactive — plan picker for admin hub',
    description:
      'Filter by niche, category, tier. Use activeOnly=true for assign flows.',
  })
  @ApiOkResponse({ type: [PlanResponseDto] })
  findAll(@Query() query: AdminListPlansQueryDto): Promise<PlanResponseDto[]> {
    return this.plansService.findAllAdmin({
      category: query.category,
      niche: query.niche,
      tier: query.tier,
      activeOnly: query.activeOnly,
    });
  }
}
