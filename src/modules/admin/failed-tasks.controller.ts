import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FailedTaskStatus } from '@prisma/client';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { FailedTaskService } from '../../common/reliability/failed-task.service';
import {
  ABSOLUTE_MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  resolvePagination,
} from '../../common/http/pagination';

class ListFailedTasksQueryDto {
  @IsOptional()
  @IsIn(Object.values(FailedTaskStatus))
  status?: FailedTaskStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * Dead-letter admin surface (Phase 8).
 *
 * Access requires `platform.admin.access`: these endpoints can trigger replays of
 * cross-tenant side-effects (pipeline runs, notification delivery).
 *
 * Pagination is capped by the shared ceilings in
 * `common/http/pagination.ts`; the list endpoint ALWAYS returns a
 * bounded response regardless of query input.
 */
@ApiTags('Admin · Reliability')
@ApiCookieAuth('access_token')
@Controller('admin/failed-tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FailedTasksController {
  constructor(private readonly failedTasks: FailedTaskService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get()
  @ApiOperation({ summary: 'List dead-letter task rows' })
  async list(@Query() query: ListFailedTasksQueryDto): Promise<{
    items: Awaited<ReturnType<FailedTaskService['list']>>['items'];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { limit, offset } = resolvePagination({
      limit: query.limit,
      offset: query.offset,
      defaultLimit: DEFAULT_PAGE_LIMIT,
      maxLimit: ABSOLUTE_MAX_PAGE_LIMIT,
    });
    const { items, total } = await this.failedTasks.list({
      status: query.status,
      limit,
      offset,
    });
    return { items, total, limit, offset };
  }
}
