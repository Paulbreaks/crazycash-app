import { pathToFileURL } from 'node:url';
import { prisma } from '../plugins/prisma.js';

const DELETE_BATCH_SIZE = 500;

type GuestCleanupOptions = {
  now?: Date;
  dryRun?: boolean;
};

export type GuestCleanupResult = {
  revokedSessions: number;
  deletedSessions: number;
  deletedGuests: number;
  deletedTonProofChallenges: number;
  dryRun: boolean;
};

/**
 * Conservative retention policy for browser guests:
 *
 * - Every expired guest session is revoked.
 * - A guest is deleted 24h after its last successful FUN spin (or creation).
 * - FUN operational records are disposable; aggregate analytics is retained
 *   independently in player_statistics.
 */
export async function cleanupExpiredGuests(
  { now = new Date(), dryRun = false }: GuestCleanupOptions = {},
): Promise<GuestCleanupResult> {
  const deletableGuestWhere = {
    accountType: 'guest' as const,
    guestExpiresAt: { lte: now },
  };

  if (dryRun) {
    const [revokedSessions, deletedGuests] = await prisma.$transaction([
      prisma.session.count({ where: { revokedAt: null, user: { is: deletableGuestWhere } } }),
      prisma.user.count({ where: deletableGuestWhere }),
    ]);
    const deletedTonProofChallenges = await prisma.tonProofChallenge.count({ where: { expiresAt: { lte: now } } });
    return { revokedSessions, deletedSessions: 0, deletedGuests, deletedTonProofChallenges, dryRun: true };
  }

  const revokedSessions = await prisma.session.updateMany({
    where: { revokedAt: null, user: { is: deletableGuestWhere } },
    data: { revokedAt: now },
  });
  // `ton_proof` challenges are single-use and short lived. This hourly job
  // prevents abandoned connect attempts from becoming an unbounded table.
  const deletedTonProofChallenges = await prisma.tonProofChallenge.deleteMany({
    where: { expiresAt: { lte: now } },
  });

  let deletedSessions = 0;
  let deletedGuests = 0;

  // Batching bounds every transaction and makes the job safe for a long-lived
  // deployment with many disposable browser accounts.
  while (true) {
    const guestIds = await prisma.user.findMany({
      where: deletableGuestWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: DELETE_BATCH_SIZE,
    });
    if (guestIds.length === 0) break;

    const ids = guestIds.map(({ id }) => id);
    const result = await prisma.$transaction(async (tx) => {
      let sessions = 0;
      let guests = 0;
      for (const id of ids) {
        // Lock prevents a concurrent last-second spin from being deleted.
        const locked = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM users WHERE id = ${id} AND account_type = 'guest'
            AND guest_expires_at <= ${now} FOR UPDATE
        `;
        if (locked.length !== 1) continue;
        await tx.playerStatistics.updateMany({ where: { sourceUserUuid: (await tx.user.findUniqueOrThrow({ where: { id }, select: { uuid: true } })).uuid }, data: { guestDeletedAt: now, lastSeenAt: now } });
        await tx.funSpin.deleteMany({ where: { userId: id } });
        // Durable command acknowledgements are operational records for a
        // disposable FUN-only guest, not financial ledger entries. They must
        // be removed before the RESTRICT FK permits deleting its owner.
        await tx.clientOperation.deleteMany({ where: { userId: id } });
        const deleted = await tx.session.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
        sessions += deleted.count;
        guests += 1;
      }
      return { sessions, guests };
    });

    deletedSessions += result.sessions;
    deletedGuests += result.guests;
    if (result.guests < guestIds.length) break;
  }

  return {
    revokedSessions: revokedSessions.count,
    deletedSessions,
    deletedGuests,
    deletedTonProofChallenges: deletedTonProofChallenges.count,
    dryRun: false,
  };
}

async function main(): Promise<void> {
  // pnpm forwards an extra `--` separator before script arguments.
  const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'));
  if ([...args].some((arg) => arg !== '--dry-run')) {
    throw new Error('Usage: guest:cleanup [--dry-run]');
  }

  const result = await cleanupExpiredGuests({ dryRun: args.has('--dry-run') });
  // No identifiers, IP addresses, token hashes or other personal data belong
  // in a recurring worker log.
  console.info(JSON.stringify({ event: 'guest_cleanup_completed', ...result }));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main()
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        event: 'guest_cleanup_failed',
        message: error instanceof Error ? error.message : 'Unknown cleanup failure',
      }));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
