import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FailedTaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Discriminator values used by the replay endpoint to dispatch back to
 * the right feature. Kept as a union so adding a new task kind is a
 * single-line type change that forces exhaustive handling downstream.
 */
export type FailedTaskType =
  | 'pipeline.run'
  | 'notification.delivery'
  | 'meta.send';

export interface RecordFailureParams {
  readonly companyId?: string | null;
  readonly taskType: FailedTaskType;
  readonly payload: Record<string, unknown>;
  readonly error: unknown;
  readonly attempts: number;
}

export interface FailedTaskSummary {
  readonly id: string;
  readonly companyId: string | null;
  readonly taskType: string;
  readonly status: FailedTaskStatus;
  readonly attempts: number;
  readonly lastError: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly replacedById: string | null;
}

export interface FailedTaskDetail extends FailedTaskSummary {
  readonly payload: Prisma.JsonValue;
}

/**
 * Dead-letter capture + replay API.
 *
 * Flow:
 *   1. Fire-and-forget work that exhausts its retry budget OR hits a
 *      terminal classification calls {@link record}. One row per failure.
 *   2. Operators see a bounded list via {@link list} (admin-only).
 *   3. Replay dispatches back to the originator through the registered
 *      handler (see `registerHandler` on app bootstrap). A successful
 *      replay flips the row to REPLAYED + stamps `replacedById`.
 *   4. Unrecoverable failures are marked ABANDONED manually.
 *
 * We deliberately keep the dispatcher out of this module — the handler
 * map is wired at bootstrap by each feature (pipeline, notifications,
 * meta send). That way this service has zero feature-specific imports
 * and cannot circular-dep its consumers.
 */
@Injectable()
export class FailedTaskService {
  private readonly logger = new Logger(FailedTaskService.name);
  private readonly handlers = new Map<
    FailedTaskType,
    (payload: Prisma.JsonValue) => Promise<string>
  >();

  constructor(private readonly prisma: PrismaService) {}

  registerHandler(
    taskType: FailedTaskType,
    handler: (payload: Prisma.JsonValue) => Promise<string>,
  ): void {
    this.handlers.set(taskType, handler);
  }

  async record(params: RecordFailureParams): Promise<string> {
    const lastError = truncateError(params.error);
    const cleanPayload = this.sanitize(params.payload);
    const created = await this.prisma.failedTask.create({
      data: {
        companyId: params.companyId ?? null,
        taskType: params.taskType,
        payload: cleanPayload,
        lastError,
        attempts: params.attempts,
      },
      select: { id: true },
    });
    this.logger.warn(
      `dlq.captured task_type=${params.taskType} id=${created.id} attempts=${params.attempts} error="${lastError}"`,
    );
    return created.id;
  }

  async list(params: {
    status?: FailedTaskStatus;
    companyId?: string | null;
    limit: number;
    offset: number;
  }): Promise<{ items: FailedTaskSummary[]; total: number }> {
    const where: Prisma.FailedTaskWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.companyId !== undefined) where.companyId = params.companyId;

    const [rows, total] = await Promise.all([
      this.prisma.failedTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit,
        skip: params.offset,
        select: SUMMARY_SELECT,
      }),
      this.prisma.failedTask.count({ where }),
    ]);

    return { items: rows, total };
  }

  async detail(id: string): Promise<FailedTaskDetail> {
    const row = await this.prisma.failedTask.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException(`FailedTask ${id} not found`);
    return row;
  }

  async replay(id: string): Promise<{ status: string; replacedById: string | null }> {
    const row = await this.prisma.failedTask.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException(`FailedTask ${id} not found`);
    if (row.status !== FailedTaskStatus.PENDING_REPLAY) {
      return { status: `noop:${row.status}`, replacedById: row.replacedById };
    }

    const handler = this.handlers.get(row.taskType as FailedTaskType);
    if (!handler) {
      throw new Error(
        `No replay handler registered for task_type=${row.taskType}`,
      );
    }

    try {
      const replacedById = await handler(row.payload);
      await this.prisma.failedTask.update({
        where: { id },
        data: {
          status: FailedTaskStatus.REPLAYED,
          replacedById,
          updatedAt: new Date(),
        },
      });
      this.logger.log(
        `dlq.replayed task_type=${row.taskType} id=${id} replaced_by=${replacedById}`,
      );
      return { status: 'replayed', replacedById };
    } catch (error) {
      const lastError = truncateError(error);
      await this.prisma.failedTask.update({
        where: { id },
        data: {
          attempts: row.attempts + 1,
          lastError,
          updatedAt: new Date(),
        },
      });
      this.logger.warn(
        `dlq.replay_failed task_type=${row.taskType} id=${id} attempts=${row.attempts + 1} error="${lastError}"`,
      );
      throw error;
    }
  }

  async abandon(id: string, reason: string): Promise<void> {
    const row = await this.prisma.failedTask.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!row) throw new NotFoundException(`FailedTask ${id} not found`);
    if (row.status !== FailedTaskStatus.PENDING_REPLAY) return;
    await this.prisma.failedTask.update({
      where: { id },
      data: {
        status: FailedTaskStatus.ABANDONED,
        lastError: truncate(reason, 2000),
        updatedAt: new Date(),
      },
    });
  }

  private sanitize(payload: Record<string, unknown>): Prisma.InputJsonValue {
    const SENSITIVE = new Set([
      'password',
      'token',
      'accessToken',
      'apiKey',
      'secret',
      'authorization',
      'cookie',
    ]);
    const walk = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) return value.map(walk);
      if (typeof value === 'object') {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (SENSITIVE.has(k)) continue;
          cleaned[k] = walk(v);
        }
        return cleaned;
      }
      return value;
    };
    return JSON.parse(JSON.stringify(walk(payload))) as Prisma.InputJsonValue;
  }
}

const SUMMARY_SELECT = {
  id: true,
  companyId: true,
  taskType: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  replacedById: true,
} as const satisfies Prisma.FailedTaskSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  payload: true,
} as const satisfies Prisma.FailedTaskSelect;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function truncateError(error: unknown): string {
  if (error instanceof Error) {
    return truncate(`${error.name}: ${error.message}`, 2000);
  }
  return truncate(String(error), 2000);
}
