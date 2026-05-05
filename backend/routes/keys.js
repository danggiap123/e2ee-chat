const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── POST /keys/upload ───────────────────────────────────────────────────────
router.post('/upload', requireAuth, async (req, res) => {
  try {
    const { ikPub, spkPub, spkSig, opkPubs } = req.body;

    if (!ikPub || !spkPub || !spkSig || !Array.isArray(opkPubs) || opkPubs.length === 0) {
      return res.status(400).json({ error: 'Thiếu trường bắt buộc: ikPub, spkPub, spkSig, opkPubs[]' });
    }

    const existing = await prisma.keyBundle.findUnique({
      where: { userId: req.user.userId },
    });

    if (existing) {
      return res.status(409).json({ error: 'Key bundle đã tồn tại. Dùng /keys/opk hoặc /keys/spk để cập nhật' });
    }

    await prisma.keyBundle.create({
      data: { userId: req.user.userId, ikPub, spkPub, spkSig, opkPubs },
    });

    return res.status(201).json({ message: 'Upload key bundle thành công' });
  } catch (err) {
    console.error('[POST /keys/upload]', err);
    return res.status(500).json({ error: 'Lỗi server khi upload key bundle' });
  }
});

// ─── GET /keys/:userId ────────────────────────────────────────────────────────
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const bundle = await prisma.keyBundle.findUnique({
      where: { userId: req.params.userId },
    });

    if (!bundle) {
      return res.status(404).json({ error: 'User chưa upload key bundle' });
    }

    if (bundle.opkPubs.length === 0) {
      return res.status(410).json({ error: 'Hết OPK — Alice cần upload thêm' });
    }

    const [opkPub, ...remainingOpks] = bundle.opkPubs;

    // Xóa OPK vừa lấy khỏi DB ngay lập tức — dùng 1 lần rồi bỏ, tránh replay attack
    await prisma.keyBundle.update({
      where: { userId: req.params.userId },
      data: { opkPubs: remainingOpks },
    });

    return res.json({
      ikPub: bundle.ikPub,
      spkPub: bundle.spkPub,
      spkSig: bundle.spkSig,
      opkPub,
      opkId: bundle.id,
    });
  } catch (err) {
    console.error('[GET /keys/:userId]', err);
    return res.status(500).json({ error: 'Lỗi server khi lấy key bundle' });
  }
});

// ─── POST /keys/opk ──────────────────────────────────────────────────────────
router.post('/opk', requireAuth, async (req, res) => {
  try {
    const { opkPubs } = req.body;
    const MAX_OPK = 100;

    if (!Array.isArray(opkPubs) || opkPubs.length === 0) {
      return res.status(400).json({ error: 'opkPubs phải là mảng không rỗng' });
    }

    const existing = await prisma.keyBundle.findUnique({
      where: { userId: req.user.userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Chưa có key bundle, hãy gọi /upload trước' });
    }

    const currentCount = existing.opkPubs.length;

    if (currentCount >= MAX_OPK) {
      return res.status(400).json({
        error: `Đã có ${currentCount} OPK, không cần thêm`,
        current: currentCount,
      });
    }

    const canAdd = MAX_OPK - currentCount;
    const toAdd  = opkPubs.slice(0, canAdd);

    await prisma.keyBundle.update({
      where: { userId: req.user.userId },
      data:  { opkPubs: { push: toAdd } },
    });

    return res.json({
      message:  `Đã thêm ${toAdd.length} OPK mới`,
      added:    toAdd.length,
      previous: currentCount,
      current:  currentCount + toAdd.length,
    });
  } catch (err) {
    console.error('[POST /keys/opk]', err);
    return res.status(500).json({ error: 'Lỗi server khi thêm OPK' });
  }
});

// ─── POST /keys/spk ──────────────────────────────────────────────────────────
router.post('/spk', requireAuth, async (req, res) => {
  try {
    const { spkPub, spkSig } = req.body;

    if (!spkPub || !spkSig) {
      return res.status(400).json({ error: 'Thiếu spkPub hoặc spkSig' });
    }

    const existing = await prisma.keyBundle.findUnique({
      where: { userId: req.user.userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Chưa có key bundle, hãy gọi /upload trước' });
    }

    // Chỉ update 2 trường SPK — IK và opkPubs giữ nguyên hoàn toàn
    await prisma.keyBundle.update({
      where: { userId: req.user.userId },
      data: { spkPub, spkSig },
    });

    return res.json({ message: 'Rotate SPK thành công' });
  } catch (err) {
    console.error('[POST /keys/spk]', err);
    return res.status(500).json({ error: 'Lỗi server khi rotate SPK' });
  }
});

module.exports = router;
