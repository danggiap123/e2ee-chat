const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const redis = require('../redis');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12; // cost factor — hash lặp 2^12 = 4096 lần, mất ~300ms

// Hash giả dùng để chống timing attack khi username không tồn tại
const DUMMY_HASH = '$2b$12$somerandombcrypthashvalueusedfordummyverification1234';

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// windowMs : 15 phút tính bằng milliseconds (15 * 60 * 1000)
// limit    : tối đa bao nhiêu request trong khoảng windowMs
// message  : JSON trả về khi bị chặn (standardHeaders + legacyHeaders tắt noise)
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Quá nhiều yêu cầu đăng ký, thử lại sau 15 phút' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Quá nhiều yêu cầu đăng nhập, thử lại sau 15 phút' },
});

// POST /auth/register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'username, password và email là bắt buộc' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password phải có ít nhất 8 ký tự' });
    }

    const existingByUsername = await prisma.user.findUnique({ where: { username } });
    if (existingByUsername) {
      return res.status(409).json({ error: 'Username đã tồn tại' });
    }

    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return res.status(409).json({ error: 'Email này đã được dùng để tạo tài khoản khác' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // ADMIN_SEED_EMAIL: email đặc biệt do IT set trong docker-compose.yml —
    // bypass whitelist và tự động được gán role ADMIN khi đăng ký lần đầu.
    // Mục đích: phá vỡ chicken-and-egg (chưa có admin nào để thêm whitelist).
    const seedEmail = process.env.ADMIN_SEED_EMAIL?.toLowerCase().trim();
    const isAdminSeed = seedEmail && email.toLowerCase().trim() === seedEmail;

    let newUser;

    if (isAdminSeed) {
      // Tạo thẳng không qua whitelist, gán role ADMIN
      newUser = await prisma.user.create({
        data: { username, email, passwordHash: hash, role: 'ADMIN' },
      });
    } else {
      // Luồng thông thường: phải có trong whitelist
      const allowed = await prisma.allowedEmail.findUnique({ where: { email } });
      if (!allowed) {
        return res.status(403).json({ error: 'Email này không được phép đăng ký' });
      }
      if (allowed.usedAt !== null) {
        return res.status(409).json({ error: 'Email này đã được sử dụng để đăng ký tài khoản' });
      }

      // Tạo user + đánh dấu email đã dùng trong 1 transaction —
      // tránh race condition giữa lúc check và lúc update usedAt
      newUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { username, email, passwordHash: hash },
        });
        await tx.allowedEmail.update({
          where: { email },
          data: { usedAt: new Date() },
        });
        return user;
      });
    }

    return res.status(201).json({ message: 'Đăng ký thành công, vui lòng đăng nhập', userId: newUser.id });
  } catch (err) {
    console.error('[POST /register]', err);
    return res.status(500).json({ error: 'Lỗi server khi đăng ký' });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username và password là bắt buộc' });
    }

    const user = await prisma.user.findUnique({ where: { username } });

    // Luôn chạy verify dù user có tồn tại hay không — chống timing attack
    const hashToVerify = user ? user.passwordHash : DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToVerify);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Sai username hoặc password' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
    }

    // Gắn role vào JWT để backend và frontend đều biết quyền của user
    // mà không cần query DB thêm lần nào
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.json({ token, userId: user.id, username: user.username, role: user.role });
  } catch (err) {
    console.error('[POST /login]', err);
    return res.status(500).json({ error: 'Lỗi server khi đăng nhập' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const exp = req.user.exp; // Unix timestamp (giây) lúc token hết hạn
    const ttl = exp - Math.floor(Date.now() / 1000); // số giây còn lại

    if (ttl > 0) {
      await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
    }

    return res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('[POST /logout]', err);
    return res.status(500).json({ error: 'Lỗi server khi đăng xuất' });
  }
});

module.exports = router;
