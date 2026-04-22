import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FailedTaskStatus, Role } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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

class AbandonFailedTaskDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * Dead-letter admin surface (Phase 8).
 *
 * Access is SUPER_ADMIN only: these endpoints can trigger replays of
 * cross-tenant side-effects (pipeline runs, notification delivery). A
 * tenant-scoped CLIENT must never reach this controller — we enforce
 * both the JWT guard and an explicit role check.
 *
 * Pagination is capped by the shared ceilings in
 * `common/http/pagination.ts`; the list endpoint ALWAYS returns a
 * bounded response regardless of query input.
 */
@ApiTags('Admin · Reliability')
@ApiCookieAuth('access_token')
@Controller('admin/failed-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class FailedTasksController {
  constructor(private readonly failedTasks: FailedTaskService) {}

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

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single DLQ row with payload' })
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.failedTasks.detail(id);
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay the task using the registered handler' })
  replay(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.failedTasks.replay(id);
  }

  @Post(':id/abandon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark as ABANDONED (irrecoverable)' })
  async abandon(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AbandonFailedTaskDto,
  ): Promise<{ abandoned: true }> {
    await this.failedTasks.abandon(id, body.reason);
    return { abandoned: true };
  }
}
