import { Prisma, BillingCycle } from '@prisma/client';

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value.toString());
}

export function effectiveMonthlyFromSubscriptionPricing(input: {
  billingCycle: BillingCycle;
  priceMonthly: Prisma.Decimal;
  priceAnnual: Prisma.Decimal | null;
}): number {
  if (input.billingCycle === 'ANNUAL' && input.priceAnnual !== null) {
    return decimalToNumber(input.priceAnnual) / 12;
  }
  return decimalToNumber(input.priceMonthly);
}

export function toIso(d: Date): string {
  return d.toISOString();
}
