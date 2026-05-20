import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface AttendeeSearchResult {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: 'user' | 'contact';
  group: string;
  groupKey: string;
  companyName: string;
  roleName?: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchAttendees(
    query: string,
    requester: AuthenticatedUser,
    appointmentId?: string,
  ): Promise<AttendeeSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }

    const results: AttendeeSearchResult[] = [];
    const roleName = requester.roleName;

    const alreadyInvited = appointmentId
      ? await this.prisma.appointment_attendees.findMany({
          where: { appointment_id: appointmentId },
          select: { user_id: true, contact_id: true },
        })
      : [];

    const excludeUserIds = new Set<string>([requester.id]);
    for (const row of alreadyInvited) {
      if (row.user_id) excludeUserIds.add(row.user_id);
    }

    const excludeContactIds = new Set<string>();
    for (const row of alreadyInvited) {
      if (row.contact_id) excludeContactIds.add(row.contact_id);
    }

    const userWhereBase = {
      isActive: true,
      id: { notIn: [...excludeUserIds] },
      OR: [
        { firstName: { contains: trimmed, mode: 'insensitive' as const } },
        { lastName: { contains: trimmed, mode: 'insensitive' as const } },
        { email: { contains: trimmed, mode: 'insensitive' as const } },
      ],
    };

    if (roleName === 'SUPER_ADMIN' || roleName === 'SIMPLEX_STAFF') {
      const simplexUsers = await this.prisma.user.findMany({
        where: {
          ...userWhereBase,
          company: { is_platform_owner: true },
        },
        include: { company: { select: { name: true } } },
        take: 5,
      });

      results.push(
        ...simplexUsers.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          type: 'user' as const,
          group: 'SimplexLabs Team',
          groupKey: 'simplex_team',
          companyName: u.company?.name ?? 'SimplexLabs',
          roleName: u.role_name,
        })),
      );

      const clientUsers = await this.prisma.user.findMany({
        where: {
          ...userWhereBase,
          company: { is_platform_owner: false },
        },
        include: { company: { select: { name: true } } },
        take: 10,
      });

      results.push(
        ...clientUsers.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          type: 'user' as const,
          group: u.company?.name ?? 'Client',
          groupKey: 'company_team',
          companyName: u.company?.name ?? '',
          roleName: u.role_name,
        })),
      );

      return results;
    }

    if (roleName === 'COMPANY_ADMIN' || roleName === 'COMPANY_STAFF') {
      if (!requester.companyId) {
        return [];
      }

      const simplexUsers = await this.prisma.user.findMany({
        where: {
          ...userWhereBase,
          company: { is_platform_owner: true },
        },
        include: { company: { select: { name: true } } },
        take: 5,
      });

      results.push(
        ...simplexUsers.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          type: 'user' as const,
          group: 'SimplexLabs Team',
          groupKey: 'simplex_team',
          companyName: u.company?.name ?? 'SimplexLabs',
          roleName: u.role_name,
        })),
      );

      const ownStaff = await this.prisma.user.findMany({
        where: {
          ...userWhereBase,
          companyId: requester.companyId,
        },
        include: { company: { select: { name: true } } },
        take: 5,
      });

      results.push(
        ...ownStaff.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          type: 'user' as const,
          group: 'My Team',
          groupKey: 'company_team',
          companyName: u.company?.name ?? '',
          roleName: u.role_name,
        })),
      );

      const contacts = await this.prisma.clientContact.findMany({
        where: {
          id: { notIn: [...excludeContactIds] },
          companyId: requester.companyId,
          OR: [
            { firstName: { contains: trimmed, mode: 'insensitive' } },
            { lastName: { contains: trimmed, mode: 'insensitive' } },
            { phone: { contains: trimmed, mode: 'insensitive' } },
            { email: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        include: { company: { select: { name: true } } },
        take: 5,
      });

      results.push(
        ...contacts.map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          type: 'contact' as const,
          group: 'Customers',
          groupKey: 'customers',
          companyName: c.company?.name ?? '',
        })),
      );

      return results;
    }

    if (!requester.companyId) {
      return [];
    }

    const ownUsers = await this.prisma.user.findMany({
      where: {
        ...userWhereBase,
        companyId: requester.companyId,
      },
      include: { company: { select: { name: true } } },
      take: 8,
    });

    results.push(
      ...ownUsers.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        type: 'user' as const,
        group: 'My Team',
        groupKey: 'company_team',
        companyName: u.company?.name ?? '',
        roleName: u.role_name,
      })),
    );

    const contacts = await this.prisma.clientContact.findMany({
      where: {
        id: { notIn: [...excludeContactIds] },
        companyId: requester.companyId,
        OR: [
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
          { phone: { contains: trimmed, mode: 'insensitive' } },
          { email: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: { company: { select: { name: true } } },
      take: 8,
    });

    results.push(
      ...contacts.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        type: 'contact' as const,
        group: 'Customers',
        groupKey: 'customers',
        companyName: c.company?.name ?? '',
      })),
    );

    return results;
  }
}
