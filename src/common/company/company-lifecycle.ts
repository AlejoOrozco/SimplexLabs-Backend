import type { Prisma } from '@prisma/client';

export const COMPANY_DEACTIVATED_BY_ADMIN_DELETE =
  'Deleted by SUPER_ADMIN';

type CompanyWriteClient = {
  company: {
    update: (args: Prisma.CompanyUpdateArgs) => Promise<unknown>;
  };
};

export function buildCompanyDeactivateData(
  reason: string,
): Prisma.CompanyUpdateInput {
  return {
    isActive: false,
    deactivatedAt: new Date(),
    deactivationReason: reason,
  };
}

export function buildCompanyReactivateData(): Prisma.CompanyUpdateInput {
  return {
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
  };
}

export async function applyCompanyDeactivate(
  client: CompanyWriteClient,
  companyId: string,
  reason: string,
): Promise<void> {
  await client.company.update({
    where: { id: companyId },
    data: buildCompanyDeactivateData(reason),
  });
}

export async function applyCompanyReactivate(
  client: CompanyWriteClient,
  companyId: string,
): Promise<void> {
  await client.company.update({
    where: { id: companyId },
    data: buildCompanyReactivateData(),
  });
}
