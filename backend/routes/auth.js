const express = require('express');
const router = express.Router();
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const redis = require('../redis');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// Hash giả dùng để chống timing attack khi username không tồn tại
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaasfasf';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username và password là bắt buộc' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password phải có ít nhất 8 ký tự' });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ error: 'Username đã tồn tại' });
  }

  const hash = await argon2.hash(password, ARGON2_OPTIONS);

  await prisma.user.create({
    data: { username, passwordHash: hash },
  });

  return res.status(201).json({ message: 'Đăng ký thành công, vui lòng đăng nhập' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username và password là bắt buộc' });
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // Luôn chạy verify dù user có tồn tại hay không — chống timing attack
  const hashToVerify = user ? user.passwordHash : DUMMY_HASH;
  const valid = await argon2.verify(hashToVerify, password);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Sai username hoặc password' });
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({ token, userId: user.id, username: user.username });
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const exp = req.user.exp; // Unix timestamp (giây) lúc token hết hạn
  const ttl = exp - Math.floor(Date.now() / 1000); // số giây còn lại

  if (ttl > 0) {
    await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
  }

  return res.json({ message: 'Logged out' });
});

module.exports = router;
