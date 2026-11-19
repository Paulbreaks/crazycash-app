import { prisma } from '../../plugins/prisma.js';
import { uuidv7 } from '../../lib/uuid.js';
import type { VerifiedTelegramIdentity } from './telegram.js';

export async function upsertTelegramPlayer(
  identity: VerifiedTelegramIdentity,
  firstIp: string | null,
) {
  const telegramIdValue = BigInt(identity.telegramId);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { telegramId: telegramIdValue },
      // Existing records created by an earlier development version may have a
      // Telegram ID but a legacy default account type. Verification is the
      // authoritative moment to normalize that account to `telegram`.
      update: {
        accountType: 'telegram',
        username: identity.username,
        telegramPhotoUrl: identity.photoUrl,
      },
      create: {
        uuid: uuidv7(),
        accountType: 'telegram',
        telegramId: telegramIdValue,
        username: identity.username,
        telegramPhotoUrl: identity.photoUrl,
      },
    });
    await tx.playerStatistics.upsert({
      where: { sourceUserUuid: user.uuid },
      update: { lastSeenAt: now },
      create: {
        sourceUserUuid: user.uuid,
        accountType: 'telegram',
        telegramId: telegramIdValue,
        firstIp,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    return user;
  });
}
