import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserResponseDto } from './dto/user-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  isCompanyAdmin,
  isPlatformSuperAdmin,
} from '../../common/auth/user-role.util';

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role_name: true,
  isActive: true,
  firstLoginCompleted: true,
  companyId: true,
  timezone: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(requester: AuthenticatedUser): Promise<UserResponseDto[]> {
    const where: Prisma.UserWhereInput = isPlatformSuperAdmin(
      requester,
      requester.isPlatformOwnerCompany,
    )
      ? {}
      : (() => {
          if (!requester.companyId) {
            throw new ForbiddenException('Requester has no company scope');
          }
          return { companyId: requester.companyId };
        })();

    const rows = await this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toUserResponse(row));
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    this.assertAccess(user.companyId, requester);
    return this.toUserResponse(user);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, companyId: true, role_name: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    this.assertCanDeactivateUser(user, requester);

    if (!user.isActive) {
      return { deleted: true };
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  private toUserResponse(row: UserRow): UserResponseDto {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      roleName: row.role_name,
      isActive: row.isActive,
      firstLoginCompleted: row.firstLoginCompleted,
      companyId: row.companyId,
      timezone: row.timezone,
      createdAt: row.createdAt,
    };
  }

  private assertAccess(
    targetCompanyId: string | null,
    requester: AuthenticatedUser,
  ): void {
    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      return;
    }
    if (targetCompanyId !== requester.companyId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private assertCanDeactivateUser(
    target: { companyId: string | null; role_name: string },
    requester: AuthenticatedUser,
  ): void {
    if (target.role_name === 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot deactivate a Super Administrator');
    }

    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      return;
    }

    if (isCompanyAdmin(requester)) {
      if (target.companyId !== requester.companyId) {
        throw new ForbiddenException('Access denied');
      }
      if (target.role_name === 'COMPANY_ADMIN') {
        throw new ForbiddenException('Cannot deactivate a company administrator');
      }
      return;
    }

    throw new ForbiddenException('You cannot deactivate users');
  }
}
