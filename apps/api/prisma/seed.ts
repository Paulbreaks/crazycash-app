import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const player = await prisma.player.upsert({
    where: { telegramId: 'demo_telegram_id' },
    update: {},
    create: { telegramId: 'demo_telegram_id', username: 'demo' },
  });

  await prisma.score.create({
    data: { playerId: player.id, value: 100 },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
