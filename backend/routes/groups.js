const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── POST /groups ─────────────────────────────────────────────────────────────
// Tạo nhóm mới. Body: { name, memberIds: [userId, ...] }
// Người tạo tự động là thành viên và là admin duy nhất
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, memberIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Thiếu tên nhóm' });
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'Nhóm phải có ít nhất 1 thành viên khác' });
    }

    // Loại bỏ trùng lặp và loại bỏ chính mình (sẽ được thêm tự động)
    const uniqueIds = [...new Set(memberIds)].filter(id => id !== req.user.userId);

    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: 'Nhóm phải có ít nhất 1 thành viên khác ngoài bạn' });
    }

    // Kiểm tra tất cả userId có tồn tại không
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });

    if (users.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'Một hoặc nhiều người dùng không tồn tại' });
    }

    // Tạo group + thêm tất cả thành viên trong 1 transaction
    const group = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.group.create({
        data: { name: name.trim(), createdBy: req.user.userId },
      });

      const allMemberIds = [req.user.userId, ...uniqueIds];
      await tx.groupMember.createMany({
        data: allMemberIds.map(userId => ({ groupId: newGroup.id, userId })),
      });

      return newGroup;
    });

    return res.status(201).json({
      groupId: group.id,
      name: group.name,
      createdBy: group.createdBy,
      message: 'Tạo nhóm thành công',
    });
  } catch (err) {
    console.error('[POST /groups]', err);
    return res.status(500).json({ error: 'Lỗi server khi tạo nhóm' });
  }
});

// ─── GET /groups ──────────────────────────────────────────────────────────────
// Lấy danh sách nhóm mà user đang đăng nhập là thành viên
router.get('/', requireAuth, async (req, res) => {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.userId },
      select: {
        group: {
          select: {
            id: true,
            name: true,
            createdBy: true,
            createdAt: true,
            members: {
              select: {
                user: { select: { id: true, username: true } },
              },
            },
            messages: {
              where: { recipientId: req.user.userId },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    const groups = memberships.map(({ group }) => ({
      groupId: group.id,
      name: group.name,
      createdBy: group.createdBy,
      members: group.members.map(m => ({
        id: m.user.id,
        username: m.user.username,
      })),
      lastMessageAt: group.messages[0]?.createdAt ?? group.createdAt,
    }));

    groups.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    return res.json({ groups });
  } catch (err) {
    console.error('[GET /groups]', err);
    return res.status(500).json({ error: 'Lỗi server khi lấy danh sách nhóm' });
  }
});

// ─── GET /groups/:groupId/members ─────────────────────────────────────────────
// Lấy danh sách thành viên của nhóm — chỉ thành viên mới xem được
router.get('/:groupId/members', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.userId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Bạn không phải thành viên của nhóm này' });
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: {
        joinedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            keyBundle: { select: { ikPub: true } },
          },
        },
      },
    });

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { createdBy: true },
    });

    return res.json({
      members: members.map(m => ({
        id: m.user.id,
        username: m.user.username,
        ikPub: m.user.keyBundle?.ikPub ?? null,
        isAdmin: m.user.id === group.createdBy,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    console.error('[GET /groups/:groupId/members]', err);
    return res.status(500).json({ error: 'Lỗi server khi lấy danh sách thành viên' });
  }
});

// ─── POST /groups/:groupId/members ────────────────────────────────────────────
// Thêm thành viên vào nhóm — chỉ người tạo nhóm mới được phép
router.post('/:groupId/members', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Thiếu userId' });
    }

    const group = await prisma.group.findUnique({ where: { id: groupId } });

    if (!group) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }

    if (group.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Chỉ người tạo nhóm mới được thêm thành viên' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'Người dùng không tồn tại' });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (existing) {
      return res.status(409).json({ error: 'Người dùng đã là thành viên của nhóm' });
    }

    await prisma.groupMember.create({ data: { groupId, userId } });

    return res.status(201).json({ message: 'Thêm thành viên thành công' });
  } catch (err) {
    console.error('[POST /groups/:groupId/members]', err);
    return res.status(500).json({ error: 'Lỗi server khi thêm thành viên' });
  }
});

// ─── DELETE /groups/:groupId/members/:userId ──────────────────────────────────
// Xóa thành viên khỏi nhóm — chỉ người tạo nhóm mới được phép
router.delete('/:groupId/members/:userId', requireAuth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const group = await prisma.group.findUnique({ where: { id: groupId } });

    if (!group) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }

    if (group.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Chỉ người tạo nhóm mới được xóa thành viên' });
    }

    if (userId === req.user.userId) {
      return res.status(400).json({ error: 'Không thể tự xóa mình khỏi nhóm' });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Người dùng không phải thành viên của nhóm' });
    }

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    return res.json({ message: 'Đã xóa thành viên khỏi nhóm' });
  } catch (err) {
    console.error('[DELETE /groups/:groupId/members/:userId]', err);
    return res.status(500).json({ error: 'Lỗi server khi xóa thành viên' });
  }
});

module.exports = router;
