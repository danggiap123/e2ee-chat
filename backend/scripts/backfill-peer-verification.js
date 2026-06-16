const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfill() {
  const verified = await prisma.conversation.findMany({
    where: { fingerprintVerified: true },
    select: { participantA: true, participantB: true },
  });

  console.log('Conversations đã verify:', verified.length);

  let count = 0;
  for (const conv of verified) {
    // Cả 2 chiều: A đã confirm với B và B đã confirm với A
    await prisma.peerVerification.upsert({
      where: { verifierId_peerId: { verifierId: conv.participantA, peerId: conv.participantB } },
      create: { verifierId: conv.participantA, peerId: conv.participantB },
      update: {},
    });
    await prisma.peerVerification.upsert({
      where: { verifierId_peerId: { verifierId: conv.participantB, peerId: conv.participantA } },
      create: { verifierId: conv.participantB, peerId: conv.participantA },
      update: {},
    });
    count += 2;
  }

  console.log('Đã tạo', count, 'bản ghi PeerVerification');
  await prisma.$disconnect();
}

backfill().catch(e => { console.error(e); process.exit(1); });
