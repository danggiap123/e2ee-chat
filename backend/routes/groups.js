const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { broadcastToGroupMembers, sendToUser } = require('../ws/handler');

const prisma = new PrismaClient();

// ─── Helper: tạo system message + broadcast cho cả nhóm ─────────────────────
// Dùng chung bởi add/remove/leave/transfer để tránh lặp code
async function createAndBroadcastSystemMessage(groupId, senderId, text) {
  const msg = await prisma.message.create({
    data: {
      groupId,
      senderId,
      isSystem: true,
      systemText: text,
    },
  });

  // Broadcast cho tất cả thành viên hiện tại (bao gồm người vừa được thêm nếu có)
  await broadcastToGroupMembers(groupId, {
    type: 'group_system_message',
    groupId,
    message: { id: msg.id, isSystem: true, systemText: text, senderId, createdAt: msg.createdAt },
  });

  return msg;
}

// ─── POST /groups ─────────────────────────────────────────────────────────────
// Tạo nhóm mới. Body: { name, memberIds: [userId, ...] }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, memberIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Thiếu tên nhóm' });
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'Nhóm phải có ít nhất 1 thành viên khác' });
    }

    const uniqueIds = [...new Set(memberIds)].filter(id => id !== req.user.userId);

    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: 'Nhóm phải có ít nhất 1 thành viên khác ngoài bạn' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });

    if (users.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'Một hoặc nhiều người dùng không tồn tại' });
    }

    const group = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.group.create({
        data: {
          name: name.trim(),
          createdBy: req.user.userId,
          adminId: req.user.userId,   // adminId = người tạo khi mới lập nhóm
        },
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
      adminId: group.adminId,
      message: 'Tạo nhóm thành công',
    });
  } catch (err) {
    console.error('[POST /groups]', err);
    return res.status(500).json({ error: 'Lỗi server khi tạo nhóm' });
  }
});

// ─── GET /groups ──────────────────────────────────────────────────────────────
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
            adminId: true,
            createdAt: true,
            members: {
              select: {
                user: { select: { id: true, username: true } },
              },
            },
            messages: {
              where: {
                OR: [
                  { recipientId: req.user.userId },
                  { isSystem: true },
                ],
              },
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
      adminId: group.adminId,
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
router.get('/:groupId/members', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.userId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Bạn không phải thành viên của nhóm này' });
    }

    const [members, group] = await Promise.all([
      prisma.groupMember.findMany({
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
      }),
      prisma.group.findUnique({
        where: { id: groupId },
        select: { adminId: true },
      }),
    ]);

    return res.json({
      members: members.map(m => ({
        id: m.user.id,
        username: m.user.username,
        ikPub: m.user.keyBundle?.ikPub ?? null,
        isAdmin: m.user.id === group.adminId,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    console.error('[GET /groups/:groupId/members]', err);
    return res.status(500).json({ error: 'Lỗi server khi lấy danh sách thành viên' });
  }
});

// ─── POST /groups/:groupId/members ────────────────────────────────────────────
// Thêm thành viên — chỉ admin mới được phép
router.post('/:groupId/members', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Thiếu userId' });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { adminId: true, name: true },
    });

    if (!group) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }

    if (group.adminId !== req.user.userId) {
      return res.status(403).json({ error: 'Chỉ admin mới được thêm thành viên' });
    }

    const newUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!newUser) {
      return res.status(404).json({ error: 'Người dùng không tồn tại' });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      return res.status(409).json({ error: 'Người dùng đã là thành viên của nhóm' });
    }

    // Lấy thông tin admin (để có username cho system message)
    const admin = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { username: true },
    });

    // Thêm thành viên vào DB
    await prisma.groupMember.create({ data: { groupId, userId } });

    // Tạo system message TRƯỚC khi broadcast (broadcastToGroupMembers query DB để lấy members)
    const systemText = `${admin.username} đã thêm ${newUser.username} vào nhóm`;
    const sysMsg = await createAndBroadcastSystemMessage(groupId, req.user.userId, systemText);

    // Lấy toàn bộ thông tin nhóm để gửi cho thành viên mới (họ cần add nhóm vào sidebar)
    const fullGroup = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true, name: true, createdBy: true, adminId: true, createdAt: true,
        members: {
          select: { user: { select: { id: true, username: true } } },
        },
      },
    });

    const groupPayload = {
      groupId: fullGroup.id,
      name: fullGroup.name,
      createdBy: fullGroup.createdBy,
      adminId: fullGroup.adminId,
      members: fullGroup.members.map(m => ({ id: m.user.id, username: m.user.username })),
      lastMessageAt: sysMsg.createdAt,
    };

    // Notify tất cả thành viên (kể cả người mới) về sự kiện thêm thành viên
    await broadcastToGroupMembers(groupId, {
      type: 'group_member_added',
      groupId,
      member: { id: newUser.id, username: newUser.username },
      addedBy: req.user.userId,
      group: groupPayload,   // người mới dùng để render nhóm trong sidebar
    });

    return res.status(201).json({ message: 'Thêm thành viên thành công' });
  } catch (err) {
    console.error('[POST /groups/:groupId/members]', err);
    return res.status(500).json({ error: 'Lỗi server khi thêm thành viên' });
  }
});

// ─── DELETE /groups/:groupId/members/:userId ──────────────────────────────────
// Hai trường hợp:
//   1. Admin xóa thành viên khác: chỉ cần userId khác mình, không cần newAdminId
//   2. Bất kỳ ai tự rời nhóm (userId == mình):
//      - Nếu là admin: phải kèm { newAdminId } trong body để chuyển quyền trước
//      - Nếu không phải admin: rời tự do
router.delete('/:groupId/members/:userId', requireAuth, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { newAdminId } = req.body ?? {};
    const isSelf = userId === req.user.userId;

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { adminId: true, name: true },
    });

    if (!group) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }

    const isAdmin = group.adminId === req.user.userId;

    // Quyền hạn:
    // - Tự rời (isSelf): luôn được phép, nhưng admin phải kèm newAdminId
    // - Xóa người khác (!isSelf): phải là admin
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Chỉ admin mới được xóa thành viên khác' });
    }

    // Nếu admin tự rời → phải chuyển quyền trước
    if (isSelf && isAdmin) {
      if (!newAdminId) {
        return res.status(400).json({ error: 'Admin phải chọn người nhận quyền admin trước khi rời nhóm' });
      }
      // Kiểm tra newAdminId phải là thành viên khác trong nhóm
      const newAdminMembership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: newAdminId } },
      });
      if (!newAdminMembership || newAdminId === req.user.userId) {
        return res.status(400).json({ error: 'Người nhận quyền admin phải là thành viên của nhóm' });
      }
    }

    // Kiểm tra target user có trong nhóm không
    const targetMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!targetMembership) {
      return res.status(404).json({ error: 'Người dùng không phải thành viên của nhóm' });
    }

    // Lấy username để tạo system message
    const [actor, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.userId }, select: { username: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
    ]);

    let newAdmin = null;
    if (isSelf && isAdmin && newAdminId) {
      newAdmin = await prisma.user.findUnique({ where: { id: newAdminId }, select: { username: true } });
    }

    // Thực hiện transaction: chuyển admin (nếu có) + xóa thành viên
    await prisma.$transaction(async (tx) => {
      if (isSelf && isAdmin && newAdminId) {
        await tx.group.update({
          where: { id: groupId },
          data: { adminId: newAdminId },
        });
      }
      await tx.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });
    });

    // Tạo system message phù hợp với từng trường hợp
    let systemText;
    if (isSelf && isAdmin && newAdmin) {
      systemText = `${actor.username} đã chuyển quyền admin cho ${newAdmin.username} và rời nhóm`;
    } else if (isSelf) {
      systemText = `${actor.username} đã rời nhóm`;
    } else {
      systemText = `${actor.username} đã xóa ${target.username} khỏi nhóm`;
    }

    // Broadcast system message đến thành viên còn lại (sau khi đã xóa userId khỏi DB)
    await createAndBroadcastSystemMessage(groupId, req.user.userId, systemText);

    // Broadcast sự kiện xóa thành viên (cả người bị xóa cũng nhận để tự xóa nhóm khỏi sidebar)
    const removePayload = {
      type: 'group_member_removed',
      groupId,
      userId,          // người bị xóa / tự rời
      removedBy: req.user.userId,
      isSelf,
      ...(newAdminId && { newAdminId }),
    };

    // Gửi cho thành viên còn lại
    await broadcastToGroupMembers(groupId, removePayload);
    // Gửi riêng cho người bị xóa (họ đã không còn trong group nên broadcastToGroupMembers bỏ qua họ)
    if (!isSelf) {
      sendToUser(userId, removePayload);
    }

    return res.json({ message: isSelf ? 'Đã rời nhóm' : 'Đã xóa thành viên khỏi nhóm' });
  } catch (err) {
    console.error('[DELETE /groups/:groupId/members/:userId]', err);
    return res.status(500).json({ error: 'Lỗi server khi xóa thành viên' });
  }
});

// ─── PATCH /groups/:groupId/admin ─────────────────────────────────────────────
// Chuyển quyền admin mà không rời nhóm — chỉ admin hiện tại mới được gọi
router.patch('/:groupId/admin', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newAdminId } = req.body;

    if (!newAdminId) {
      return res.status(400).json({ error: 'Thiếu newAdminId' });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { adminId: true },
    });

    if (!group) {
      return res.status(404).json({ error: 'Nhóm không tồn tại' });
    }

    if (group.adminId !== req.user.userId) {
      return res.status(403).json({ error: 'Chỉ admin mới được chuyển quyền' });
    }

    if (newAdminId === req.user.userId) {
      return res.status(400).json({ error: 'Bạn đã là admin rồi' });
    }

    const newAdminMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: newAdminId } },
    });
    if (!newAdminMembership) {
      return res.status(404).json({ error: 'Người nhận quyền admin không phải thành viên của nhóm' });
    }

    const [actor, newAdmin] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.userId }, select: { username: true } }),
      prisma.user.findUnique({ where: { id: newAdminId }, select: { username: true } }),
    ]);

    await prisma.group.update({
      where: { id: groupId },
      data: { adminId: newAdminId },
    });

    const systemText = `${actor.username} đã chuyển quyền admin cho ${newAdmin.username}`;
    await createAndBroadcastSystemMessage(groupId, req.user.userId, systemText);

    await broadcastToGroupMembers(groupId, {
      type: 'group_admin_transferred',
      groupId,
      newAdminId,
    });

    return res.json({ message: 'Chuyển quyền admin thành công', newAdminId });
  } catch (err) {
    console.error('[PATCH /groups/:groupId/admin]', err);
    return res.status(500).json({ error: 'Lỗi server khi chuyển quyền admin' });
  }
});

module.exports = router;
