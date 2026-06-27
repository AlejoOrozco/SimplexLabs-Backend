/**
 * Seeds a Twilio WhatsApp CompanyChannel on the platform-owner company.
 *
 * Usage (from repo root, with .env loaded):
 *   npm run seed:twilio-sandbox
 */
import 'dotenv/config';
import { Channel, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { configuration } from '../src/config/configuration';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { normalizeTwilioWhatsAppAddress } from '../src/modules/webhooks/twilio-signature.util';

async function main(): Promise<void> {
  const cfg = configuration();
  const twilio = cfg.twilio;
  if (!twilio.accountSid || !twilio.authToken || !twilio.whatsappFrom) {
    throw new Error(
      'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM must be set',
    );
  }
  if (!cfg.security.encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be set');
  }

  const configService = {
    getOrThrow: (key: string) => {
      if (key === 'security') return cfg.security;
      throw new Error(`Unknown config key: ${key}`);
    },
  } as ConfigService;
  const encryption = new EncryptionService(configService);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const owner = await prisma.company.findFirst({
    where: { is_platform_owner: true },
    select: { id: true, name: true },
  });
  if (!owner) {
    throw new Error('No platform-owner company found (is_platform_owner = true)');
  }

  const externalId = normalizeTwilioWhatsAppAddress(twilio.whatsappFrom);
  const aad = `company:${owner.id}:channel:${Channel.WHATSAPP}:external:${externalId}`;
  const encryptedAccessToken = encryption.encrypt(twilio.authToken, aad);

  // Retire legacy WHATSAPP channel rows (e.g. 360dialog) so outbound resolution
  // does not pick a stale oldest-first row.
  await prisma.companyChannel.updateMany({
    where: {
      companyId: owner.id,
      channel: Channel.WHATSAPP,
      NOT: { externalId },
    },
    data: { isActive: false },
  });

  await prisma.companyChannel.upsert({
    where: {
      channel_externalId: { channel: Channel.WHATSAPP, externalId },
    },
    create: {
      companyId: owner.id,
      channel: Channel.WHATSAPP,
      externalId,
      businessAccountId: twilio.accountSid,
      encryptedAccessToken,
      label: 'Twilio WhatsApp Sandbox',
      isActive: true,
    },
    update: {
      businessAccountId: twilio.accountSid,
      encryptedAccessToken,
      label: 'Twilio WhatsApp Sandbox',
      isActive: true,
    },
  });

  await prisma.company.update({
    where: { id: owner.id },
    data: {
      whatsappPhoneNumber: externalId.replace('whatsapp:', ''),
    },
  });

  console.log(
    `Seeded Twilio WhatsApp channel for company "${owner.name}" (${owner.id}) externalId=${externalId}`,
  );
  console.log(
    `Deactivated other WHATSAPP channel rows for this company (if any).`,
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
