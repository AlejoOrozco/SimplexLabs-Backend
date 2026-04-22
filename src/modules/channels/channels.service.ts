import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChannelResponseDto } from './dto/channel-response.dto';

const channelSelect = {
  id: true,
  companyId: true,
  channel: true,
  externalId: true,
  businessAccountId: true,
  label: true,
  isActive: true,
  encryptedAccessToken: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanyChannelSelect;

type CompanyChannelRow = Prisma.CompanyChannelGetPayload<{
  select: typeof channelSelect;
}>;

/**
 * Resolved channel credentials used by outbound senders. Only produced by
 * `resolveForSend` / `resolveByExternalId`; never returned over HTTP.
 */
export interface ResolvedChannelCredentials {
  id: string;
  companyId: string;
  channel: Channel;
  externalId: string;
  businessAccountId: string | null;
  accessToken: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async findAll(requester: AuthenticatedUser): Promise<ChannelResponseDto[]> {
    const rows = await this.prisma.companyChannel.findMany({
      where: scopedCompanyWhere(requester),
      select: channelSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    const row = await this.prisma.companyChannel.findUnique({
      where: { id },
      select: channelSelect,
    });
    if (!row) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return toResponse(row);
  }

  async create(
    dto: CreateChannelDto,
    requester: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);

    const encryptedAccessToken = this.encryption.encrypt(
      dto.accessToken,
      aadFor(companyId, dto.channel, dto.externalId),
    );

    try {
      const row = await this.prisma.companyChannel.create({
        data: {
          companyId,
          channel: dto.channel,
          externalId: dto.externalId,
          businessAccountId: dto.businessAccountId ?? null,
          label: dto.label ?? null,
          isActive: dto.isActive ?? true,
          encryptedAccessToken,
        },
        select: channelSelect,
      });
      this.logger.log(
        `Created CompanyChannel ${row.id} company=${companyId} channel=${row.channel} external_id=${row.externalId}`,
      );
      return toResponse(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new ConflictException(
            `A channel with (channel=${dto.channel}, externalId=${dto.externalId}) already exists`,
          );
        }
        if (err.code === 'P2003') {
          throw new NotFoundException(`Company ${companyId} not found`);
        }
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateChannelDto,
    requester: AuthenticatedUser,
  ): Promise<ChannelResponseDto> {
    const existing = await this.prisma.companyChannel.findUnique({
      where: { id },
      select: channelSelect,
    });
    if (!existing) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    assertTenantAccess(existing.companyId, requester);

    const data: Prisma.CompanyChannelUpdateInput = {};
    if (dto.businessAccountId !== undefined) {
      data.businessAccountId = dto.businessAccountId;
    }
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.accessToken !== undefined) {
      data.encryptedAccessToken = this.encryption.encrypt(
        dto.accessToken,
        aadFor(existing.companyId, existing.channel, existing.externalId),
      );
    }

    const row = await this.prisma.companyChannel.update({
      where: { id },
      data,
      select: channelSelect,
    });
    return toResponse(row);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.companyChannel.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    if (!existing) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    assertTenantAccess(existing.companyId, requester);

    await this.prisma.companyChannel.update({
      where: { id },
      data: { isActive: false },
      select: { id: true },
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internal lookups used by webhook ingestion / outbound senders.
  // ---------------------------------------------------------------------------

  /**
   * Map an inbound `(channel, externalId)` pair — e.g. WhatsApp
   * `phone_number_id` — to the owning company. Returns `null` when no
   * active channel row matches, so the caller can safely drop the event
   * instead of assigning it to the wrong tenant.
   */
  async resolveCompanyByExternalId(
    channel: Channel,
    externalId: string,
  ): Promise<{ companyId: string; channelId: string } | null> {
    const row = await this.prisma.companyChannel.findUnique({
      where: { channel_externalId: { channel, externalId } },
      select: { id: true, companyId: true, isActive: true },
    });
    if (!row || !row.isActive) return null;
    return { companyId: row.companyId, channelId: row.id };
  }

  /**
   * Return decrypted credentials for outbound sends. NEVER expose the
   * returned object over HTTP; it is only for server-to-server use.
   */
  async getSendingCredentials(
    companyId: string,
    channel: Channel,
  ): Promise<ResolvedChannelCredentials | null> {
    const row = await this.prisma.companyChannel.findFirst({
      where: { companyId, channel, isActive: true },
      select: channelSelect,
      orderBy: { createdAt: 'asc' },
    });
    if (!row) return null;
    return this.decryptRow(row);
  }

  async getSendingCredentialsByExternalId(
    channel: Channel,
    externalId: string,
  ): Promise<ResolvedChannelCredentials | null> {
    const row = await this.prisma.companyChannel.findUnique({
      where: { channel_externalId: { channel, externalId } },
      select: channelSelect,
    });
    if (!row || !row.isActive) return null;
    return this.decryptRow(row);
  }

  private decryptRow(row: CompanyChannelRow): ResolvedChannelCredentials {
    const accessToken = this.encryption.decrypt(
      row.encryptedAccessToken,
      aadFor(row.companyId, row.channel, row.externalId),
    );
    return {
      id: row.id,
      companyId: row.companyId,
      channel: row.channel,
      externalId: row.externalId,
      businessAccountId: row.businessAccountId,
      accessToken,
    };
  }
}

function aadFor(
  companyId: string,
  channel: Channel,
  externalId: string,
): string {
  return `company:${companyId}:channel:${channel}:external:${externalId}`;
}

function toResponse(row: CompanyChannelRow): ChannelResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    channel: row.channel,
    externalId: row.externalId,
    businessAccountId: row.businessAccountId,
    label: row.label,
    isActive: row.isActive,
    hasAccessToken: row.encryptedAccessToken.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
