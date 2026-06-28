import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationType,
  PaymentMethod,
  PlanCategory,
  SubStatus,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../common/supabase/supabase-admin.service';
import { EmailService } from '../notifications/adapters/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isPlatformSuperAdmin, canReceivePortalCredentialEmail } from '../../common/auth/user-role.util';
import { CreateClientUserDto } from './dto/create-client-user.dto';
import { CreateFullCompanyDto } from './dto/create-full-company.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { SendOnboardingCredentialsDto } from './dto/send-onboarding-credentials.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';
import {
  applyCompanyDeactivate,
  applyCompanyReactivate,
} from '../../common/company/company-lifecycle';
import { buildOnboardingAgentPromptCreates } from './onboarding-prompt-seeds';
import {
  sanitizeMultilineText,
  sanitizeSingleLineText,
} from '../agents/validation/limits';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AdminCompanyListRowDto } from './dto/admin-company-list-row.dto';

export interface CreateFullCompanyResultDto {
  readonly companyId: string;
  readonly companyName: string;
  readonly plansCreated: number;
  readonly agentConfigCreated: boolean;
}

export interface CreateClientUserResultDto {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly companyName: string;
}

export interface CreateStaffUserResultDto {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly companyName: string;
  readonly roleName: string;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*';
const PASSWORD_ALPHABET = UPPER + LOWER + NUMBERS + SYMBOLS;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Canonical SUPER_ADMIN directory of tenants: company row, primary subscription,
   * active company admin, and light rollups. Replaces the removed GET /admin/clients list.
   */
  async listAdminCompanies(): Promise<AdminCompanyListRowDto[]> {
    const rows = await this.prisma.company.findMany({
      select: {
        id: true,
        name: true,
        niche: true,
        is_platform_owner: true,
        isActive: true,
        _count: {
          select: {
            users: { where: { isActive: true } },
            conversations: true,
            orders: true,
          },
        },
        users: {
          where: { role_name: 'COMPANY_ADMIN', isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        subscriptions: {
          where: { status: SubStatus.ACTIVE },
          select: {
            status: true,
            nextBillingAt: true,
            plan: { select: { name: true, category: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => {
      const primarySub = row.subscriptions[0];
      const admin = row.users[0] ?? null;
      const activeUsers = row._count.users;
      const companyIsActive = row.isActive;
      const isOperational = companyIsActive && activeUsers > 0;

      return {
        id: row.id,
        name: row.name,
        niche: row.niche,
        isPlatformOwner: row.is_platform_owner,
        isActive: companyIsActive,
        isOperational,
        subscription: primarySub
          ? {
              planName: primarySub.plan.name,
              status: primarySub.status,
              nextBillingDate: primarySub.nextBillingAt?.toISOString() ?? null,
            }
          : null,
        primaryAdmin: admin
          ? {
              id: admin.id,
              firstName: admin.firstName,
              lastName: admin.lastName,
              email: admin.email,
              isActive: admin.isActive,
            }
          : null,
        totalConversations: row._count.conversations,
        totalOrders: row._count.orders,
      };
    });
  }

  async createFullCompany(
    dto: CreateFullCompanyDto,
    adminId: string,
  ): Promise<CreateFullCompanyResultDto> {
    if (
      dto.whatsappPhoneNumberId?.trim() ||
      dto.whatsappPhoneNumber?.trim()
    ) {
      this.logger.log(
        'WhatsApp phone fields were provided; CompanyChannel rows still require a long-lived token via POST /channels.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const seenCategories = new Set<PlanCategory>();
      const resolvedPlans: CreateFullCompanyDto['plans'] = [];

      for (const item of dto.plans) {
        const planRow = await tx.plan.findUnique({
          where: { id: item.planId },
          select: { category: true, isActive: true },
        });
        if (!planRow?.isActive || !planRow.category) {
          throw new NotFoundException(
            `Plan ${item.planId} not found, inactive, or missing category`,
          );
        }
        if (seenCategories.has(planRow.category)) {
          throw new BadRequestException(
            `Duplicate subscription category in request: ${planRow.category}`,
          );
        }
        seenCategories.add(planRow.category);
        resolvedPlans.push(item);
      }

      const hasAiAgents = seenCategories.has(PlanCategory.AI_AGENTS);
      if (hasAiAgents && !dto.agentConfig) {
        throw new BadRequestException(
          'agentConfig is required when a plan includes the AI_AGENTS category',
        );
      }
      if (!hasAiAgents && dto.agentConfig) {
        throw new BadRequestException(
          'agentConfig must be omitted unless an AI_AGENTS plan is included',
        );
      }

      let agentName = '';
      let fallbackMessage = '';
      let escalationMessage = '';
      if (dto.agentConfig) {
        agentName = sanitizeSingleLineText(dto.agentConfig.name);
        fallbackMessage = sanitizeMultilineText(
          dto.agentConfig.fallbackMessage,
        );
        escalationMessage = sanitizeMultilineText(
          dto.agentConfig.escalationMessage,
        );
        if (!agentName || !fallbackMessage || !escalationMessage) {
          throw new BadRequestException(
            'Agent name and messages must be non-empty after sanitization',
          );
        }
      }

      const company = await tx.company.create({
        data: {
          name: dto.name,
          niche: dto.niche,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
        },
        select: { id: true, name: true },
      });

      const stripeEnabled = dto.agentConfig?.paymentMethods.includes(
        PaymentMethod.STRIPE,
      )
        ? true
        : false;
      const wireEnabled = dto.agentConfig?.paymentMethods.includes(
        PaymentMethod.WIRE_TRANSFER,
      )
        ? true
        : false;

      await tx.companySettings.upsert({
        where: { companyId: company.id },
        create: {
          companyId: company.id,
          notificationEmail: dto.notificationEmail ?? null,
          notificationWhatsapp: dto.notificationPhone ?? null,
          stripeEnabled,
          wireTransferEnabled: wireEnabled,
        },
        update: {
          ...(dto.notificationEmail !== undefined
            ? { notificationEmail: dto.notificationEmail }
            : {}),
          ...(dto.notificationPhone !== undefined
            ? { notificationWhatsapp: dto.notificationPhone }
            : {}),
          stripeEnabled,
          wireTransferEnabled: wireEnabled,
        },
      });

      for (const item of resolvedPlans) {
        await this.subscriptions.createWithinTransaction(
          tx,
          {
            companyId: company.id,
            planId: item.planId,
            billingCycle: item.billingCycle,
            initialPayment: item.initialPayment,
            startedAt: item.startedAt,
          },
          adminId,
        );
      }

      let agentConfigCreated = false;
      if (dto.agentConfig && hasAiAgents) {
        await tx.agentConfig.updateMany({
          where: { companyId: company.id, isActive: true },
          data: { isActive: false },
        });

        const prompts = buildOnboardingAgentPromptCreates(
          agentName,
          company.name,
        );

        await tx.agentConfig.create({
          data: {
            companyId: company.id,
            name: agentName,
            isActive: true,
            channels: dto.agentConfig.channels,
            fallbackMessage,
            escalationMessage,
            language: 'es',
            prompts: {
              create: prompts,
            },
          },
        });
        agentConfigCreated = true;
      }

      this.logger.log(
        `Admin create-full company adminUserId=${adminId} companyId=${company.id} plans=${resolvedPlans.length} agent=${agentConfigCreated}`,
      );

      return {
        companyId: company.id,
        companyName: company.name,
        plansCreated: resolvedPlans.length,
        agentConfigCreated,
      };
    });
  }

  async createClientUser(
    dto: CreateClientUserDto,
    adminId: string,
  ): Promise<CreateClientUserResultDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true, name: true },
    });
    if (!company) {
      throw new NotFoundException(`Company ${dto.companyId} not found`);
    }

    const password = this.generateStrongPassword();
    const supabase = this.supabaseAdmin.getClient();
    const { data: authData, error: authErr } =
      await supabase.auth.admin.createUser({
        email: dto.email,
        password,
        email_confirm: true,
      });

    if (authErr || !authData.user) {
      this.logger.error(
        `Supabase createUser failed for ${dto.email}`,
        authErr?.message,
      );
      throw new InternalServerErrorException('Failed to create auth account');
    }

    const supabaseUserId = authData.user.id;

    try {
      const user = await this.prisma.$transaction(async (tx) =>
        tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role_name: 'COMPANY_ADMIN',
            companyId: company.id,
          },
          select: { id: true },
        }),
      );

      this.logger.log(
        `Admin create-client user adminUserId=${adminId} companyId=${company.id} newUserId=${user.id}`,
      );

      return {
        userId: user.id,
        email: dto.email,
        password,
        companyName: company.name,
      };
    } catch (err) {
      await this.safeDeleteSupabaseUser(supabaseUserId);
      throw err;
    }
  }

  async createStaffUser(
    dto: CreateStaffUserDto,
    adminId: string,
  ): Promise<CreateStaffUserResultDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true, name: true },
    });
    if (!company) {
      throw new NotFoundException(`Company ${dto.companyId} not found`);
    }

    const roleRow = await this.prisma.roles.findUnique({
      where: { name: dto.roleName },
      select: { name: true },
    });
    if (!roleRow) {
      throw new BadRequestException(`Unknown role: ${dto.roleName}`);
    }

    const overrides = dto.permissionOverrides ?? [];
    const overrideKeys = overrides.map((o) => o.permissionKey);
    if (new Set(overrideKeys).size !== overrideKeys.length) {
      throw new BadRequestException('Duplicate permission keys in overrides');
    }

    const password = this.generateStrongPassword();
    const supabase = this.supabaseAdmin.getClient();
    const { data: authData, error: authErr } =
      await supabase.auth.admin.createUser({
        email: dto.email,
        password,
        email_confirm: true,
      });

    if (authErr || !authData.user) {
      this.logger.error(
        `Supabase createUser failed for ${dto.email}`,
        authErr?.message,
      );
      throw new InternalServerErrorException('Failed to create auth account');
    }

    const supabaseUserId = authData.user.id;

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (overrides.length > 0) {
          const allowed = await tx.role_permissions.findMany({
            where: { role_name: dto.roleName },
            select: { permission_key: true },
          });
          const allowedSet = new Set(allowed.map((a) => a.permission_key));
          for (const o of overrides) {
            if (!allowedSet.has(o.permissionKey)) {
              throw new BadRequestException(
                `Permission is not defined for this user's role: ${o.permissionKey}`,
              );
            }
          }
        }

        const created = await tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role_name: dto.roleName,
            companyId: company.id,
            credentialsSentAt: new Date(),
          },
          select: { id: true },
        });

        const grantedAt = new Date();
        for (const o of overrides) {
          await tx.user_permissions.upsert({
            where: {
              user_id_permission_key: {
                user_id: created.id,
                permission_key: o.permissionKey,
              },
            },
            update: {
              is_granted: o.isGranted,
              granted_by_id: adminId,
              granted_at: grantedAt,
            },
            create: {
              user_id: created.id,
              permission_key: o.permissionKey,
              is_granted: o.isGranted,
              granted_by_id: adminId,
              granted_at: grantedAt,
            },
          });
        }

        return created;
      });

      this.logger.log(
        `Admin create-staff user adminUserId=${adminId} companyId=${company.id} newUserId=${user.id} role=${dto.roleName}`,
      );

      return {
        userId: user.id,
        email: dto.email,
        password,
        companyName: company.name,
        roleName: dto.roleName,
      };
    } catch (err) {
      await this.safeDeleteSupabaseUser(supabaseUserId);
      throw err;
    }
  }

  async sendOnboardingCredentials(
    dto: SendOnboardingCredentialsDto,
  ): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, email: true, role_name: true },
    });
    if (!user || !canReceivePortalCredentialEmail(user.role_name)) {
      throw new NotFoundException('User not found');
    }
    if (user.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw new BadRequestException('Email does not match the user record');
    }

    const portalLoginUrl =
      this.config.get<string[]>('frontendUrls')?.[0] ?? 'https://app.simplexlabs.org';

    const text = [
      `Hi ${dto.firstName},`,
      '',
      `Your SimplexLabs portal for ${dto.companyName} is ready.`,
      '',
      `Sign in: ${portalLoginUrl}`,
      `Login email: ${dto.email}`,
      `Temporary password: ${dto.password}`,
      '',
      'Please sign in and change your password as soon as possible.',
      '',
      'If you did not expect this message, contact your SimplexLabs representative.',
    ].join('\n');

    const result = await this.email.send({
      to: dto.email,
      subject: `Your ${dto.companyName} portal credentials`,
      text,
    });

    if (result.success) {
      await this.prisma.user.update({
        where: { id: dto.userId },
        data: { credentialsSentAt: new Date() },
      });
    }

    return { sent: result.success };
  }

  async deactivateClient(
    userId: string,
    dto: DeactivateClientDto,
    requester: AuthenticatedUser,
  ): Promise<{ deactivated: true }> {
    if (!isPlatformSuperAdmin(requester)) {
      throw new ForbiddenException('Only SUPER_ADMIN may deactivate clients');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role_name: true, companyId: true, isActive: true },
    });
    const companyId = target?.companyId;
    if (!target || target.role_name !== 'CLIENT' || !companyId) {
      throw new NotFoundException('Client user not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });
      await applyCompanyDeactivate(tx, companyId, dto.reason);
    });

    try {
      await this.notifications.create({
        companyId,
        type: NotificationType.AGENT_NEEDS_ATTENTION,
        title: 'Client account deactivated',
        body: 'A SimplexLabs administrator deactivated this company client portal.',
        payload: { userId: target.id, reasonLength: dto.reason.length },
        deliverExternal: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `Post-deactivate notification failed for company=${companyId}: ${message}`,
      );
    }

    return { deactivated: true };
  }

  async reactivateClient(
    userId: string,
    requester: AuthenticatedUser,
  ): Promise<{ reactivated: true }> {
    if (!isPlatformSuperAdmin(requester)) {
      throw new ForbiddenException('Only SUPER_ADMIN may reactivate clients');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role_name: true, companyId: true },
    });
    const companyId = target?.companyId;
    if (!target || target.role_name !== 'CLIENT' || !companyId) {
      throw new NotFoundException('Client user not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: true },
      });
      await applyCompanyReactivate(tx, companyId);
    });

    return { reactivated: true };
  }

  /**
   * Restores an entire tenant after company-wide deactivation (e.g. DELETE /companies/:id).
   * Clears company deactivation fields and sets all inactive users on the company to active.
   */
  async reactivateCompany(
    companyId: string,
    requester: AuthenticatedUser,
  ): Promise<{ reactivated: true; usersReactivated: number }> {
    if (!isPlatformSuperAdmin(requester)) {
      throw new ForbiddenException('Only SUPER_ADMIN may reactivate companies');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const usersReactivated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { companyId, isActive: false },
        data: { isActive: true },
      });
      await applyCompanyReactivate(tx, companyId);
      return count;
    });

    return { reactivated: true, usersReactivated };
  }

  private generateStrongPassword(): string {
    const required = [
      UPPER[randomInt(UPPER.length)],
      LOWER[randomInt(LOWER.length)],
      NUMBERS[randomInt(NUMBERS.length)],
      SYMBOLS[randomInt(SYMBOLS.length)],
    ];
    const rest = Array.from({ length: 12 }, () =>
      PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length)),
    );
    const chars = [...required, ...rest];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  private async safeDeleteSupabaseUser(supabaseUserId: string): Promise<void> {
    const { error } = await this.supabaseAdmin
      .getClient()
      .auth.admin.deleteUser(supabaseUserId);
    if (error) {
      this.logger.error(
        `Failed to rollback Supabase user ${supabaseUserId}: ${error.message}`,
      );
    }
  }
}
