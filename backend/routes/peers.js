const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// PATCH /peers/:peerId/verify
// Đánh dấu "tôi đã xác minh fingerprint của peerId ngoài đời thực"
// Idempotent: gọi nhiều lần không tạo bản ghi trùng (upsert)
// Không gắn với group hay conversation cụ thể — verify 1 lần, dùng được ở mọi nhóm
router.patch('/:peerId/verify', requireAuth, async (req, res) => {
  try {
    const { peerId } = req.params;

    if (peerId === req.user.userId) {
      return res.status(400).json({ error: 'Không thể xác minh chính mình' });
    }

    const peer = await prisma.user.findUnique({
      where: { id: peerId },
      select: { id: true },
    });

    if (!peer) {
      return res.status(404).json({ error: 'Người dùng không tồn tại' });
    }

    const me = req.user.userId;

    // upsert: nếu đã có bản ghi thì giữ nguyên, không throw lỗi unique constraint
    await prisma.peerVerification.upsert({
      where: { verifierId_peerId: { verifierId: me, peerId } },
      create: { verifierId: me, peerId },
      update: {},
    });

    // Đồng bộ sang Conversation.fingerprintVerified nếu 2 người đã có cuộc trò chuyện 1-1
    // Conversation lưu participantA < participantB theo thứ tự alphabet để tránh duplicate
    await prisma.conversation.updateMany({
      where: {
        OR: [
          { participantA: me, participantB: peerId },
          { participantA: peerId, participantB: me },
        ],
        fingerprintVerified: false,
      },
      data: { fingerprintVerified: true },
    });

    return res.json({ message: 'Xác minh thành công' });
  } catch (err) {
    console.error('[PATCH /peers/:peerId/verify]', err);
    return res.status(500).json({ error: 'Lỗi server khi xác minh' });
  }
});

module.exports = router;
