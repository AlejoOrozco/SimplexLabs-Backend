/**
 * Seeds 360dialog sandbox fields on the platform-owner company.
 *
 * Usage (from repo root, with .env loaded):
 *   npm run seed:dialog-sandbox
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { configuration } from '../src/config/configuration';

async function main(): Promise<void> {
  const cfg = configuration();
  const apiKey = cfg.dialog.sandboxApiKey;
  if (!apiKey) {
    throw new Error('DIALOG_SANDBOX_API_KEY is not set in the environment');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const owner = await prisma.company.findFirst({
    where: { is_platform_owner: true },
    select: { id: true, name: true },
  });
  if (!owner) {
    throw new Error('No platform-owner company found (is_platform_owner = true)');
  }

  await prisma.company.update({
    where: { id: owner.id },
    data: {
      dialogApiKey: apiKey,
      dialogBaseUrl: cfg.dialog.sandboxBaseUrl,
      whatsappPhoneNumber: cfg.dialog.sandboxNumber,
      whatsappPhoneNumberId: cfg.dialog.sandboxExternalId,
    },
  });

  console.log(
    `Seeded 360dialog sandbox for company "${owner.name}" (${owner.id})`,
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
