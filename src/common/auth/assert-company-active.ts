import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { COMPANY_DEACTIVATED } from './company-deactivated';

export async function assertCompanyActiveForUser(
  prisma: PrismaService,
  companyId: string | null,
): Promise<void> {
  if (!companyId) {
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { isActive: true },
  });

  if (!company?.isActive) {
    throw new UnauthorizedException(COMPANY_DEACTIVATED);
  }
}
