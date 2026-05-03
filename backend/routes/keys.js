const express = require('express');           // framework tạo web server
const router = express.Router();              // tạo 1 "mini router" riêng cho /keys
const { PrismaClient } = require('@prisma/client'); // ORM để query PostgreSQL
const { requireAuth } = require('../middleware/auth'); // middleware kiểm tra JWT

const prisma = new PrismaClient(); // khởi tạo kết nối DB — dùng chung 1 instance

// ─── POST /keys/upload ───────────────────────────────────────────────────────
// Alice gọi endpoint này SAU KHI đăng ký để upload public key lên server
// requireAuth đứng trước → phải có JWT hợp lệ mới vào được handler bên dưới
router.post('/upload', requireAuth, async (req, res) => {

  // Lấy 4 trường từ body request
  // ikPub   : Identity Key public  — định danh lâu dài (base64 string)
  // spkPub  : Signed PreKey public — thay định kỳ      (base64 string)
  // spkSig  : chữ ký Ed25519 trên spkPub               (base64 string)
  // opkPubs : mảng One-Time PreKey public               (base64 string[])
  const { ikPub, spkPub, spkSig, opkPubs } = req.body;

  // Validate: thiếu bất kỳ trường nào → trả 400 Bad Request ngay
  // Array.isArray() kiểm tra opkPubs phải là mảng, không phải string hay object
  if (!ikPub || !spkPub || !spkSig || !Array.isArray(opkPubs) || opkPubs.length === 0) {
    return res.status(400).json({ error: 'Thiếu trường bắt buộc: ikPub, spkPub, spkSig, opkPubs[]' });
  }

  // Kiểm tra đã có key bundle chưa — nếu có thì từ chối
  // Endpoint này chỉ dùng 1 lần sau đăng ký
  // Muốn thêm OPK → dùng POST /keys/opk
  // Muốn rotate SPK → dùng POST /keys/spk
  const existing = await prisma.keyBundle.findUnique({
    where: { userId: req.user.userId },
  });

  if (existing) {
    return res.status(409).json({ error: 'Key bundle đã tồn tại. Dùng /keys/opk hoặc /keys/spk để cập nhật' });
  }

  // create: tạo bản ghi mới — chỉ chạy được 1 lần duy nhất
  await prisma.keyBundle.create({
    data: { userId: req.user.userId, ikPub, spkPub, spkSig, opkPubs },
  });

  return res.status(201).json({ message: 'Upload key bundle thành công' });
});

// ─── GET /keys/:userId ────────────────────────────────────────────────────────
// Bob gọi endpoint này để lấy public key của Alice trước khi chạy X3DH
// :userId là tham số động — ví dụ GET /keys/abc-123 thì req.params.userId = "abc-123"
router.get('/:userId', requireAuth, async (req, res) => {

  // Tìm key bundle của Alice trong DB theo userId từ URL
  const bundle = await prisma.keyBundle.findUnique({
    where: { userId: req.params.userId },
  });

  // Nếu Alice chưa upload key bao giờ → trả 404 Not Found
  if (!bundle) {
    return res.status(404).json({ error: 'User chưa upload key bundle' });
  }

  // Nếu Alice đã hết OPK (dùng hết 100 cái ban đầu) → trả 410 Gone
  // 410 khác 404: 410 có nghĩa "từng tồn tại nhưng không còn nữa"
  // Client cần nhắc Alice sinh thêm OPK và upload
  if (bundle.opkPubs.length === 0) {
    return res.status(410).json({ error: 'Hết OPK — Alice cần upload thêm' });
  }

  // Destructuring array: lấy phần tử ĐẦU TIÊN ra làm opkPub
  // remainingOpks là mảng CÒN LẠI (không gồm phần tử đầu)
  // Ví dụ: [a, b, c] → opkPub = a, remainingOpks = [b, c]
  const [opkPub, ...remainingOpks] = bundle.opkPubs;

  // Xóa OPK vừa lấy khỏi DB ngay lập tức — dùng 1 lần rồi bỏ
  // Nếu không xóa → OPK đó có thể bị dùng lại → replay attack
  await prisma.keyBundle.update({
    where: { userId: req.params.userId },
    data: { opkPubs: remainingOpks },
  });

  // Nếu OPK còn lại < 10 → thông báo cho Alice qua WebSocket
  // Alice's browser tự sinh OPK mới và gọi POST /keys/opk — người dùng không biết gì
  // TODO: bổ sung khi làm Task 6 (WebSocket)
  // if (remainingOpks.length < 10) {
  //   notifyUser(req.params.userId, { type: 'low_opk', remaining: remainingOpks.length });
  // }

  // Trả về đúng những gì Bob cần để chạy X3DH
  return res.json({
    ikPub: bundle.ikPub,
    spkPub: bundle.spkPub,
    spkSig: bundle.spkSig,
    opkPub,
    opkId: bundle.id,
  });
});

// ─── POST /keys/opk ──────────────────────────────────────────────────────────
// Alice gọi khi OPK sắp hết — chỉ thêm OPK mới, KHÔNG đụng IK và SPK
router.post('/opk', requireAuth, async (req, res) => {

  const { opkPubs } = req.body;
  const MAX_OPK = 100; // giới hạn tối đa — đủ cho ~100 cuộc hội thoại mới

  // Validate: phải là mảng, không được rỗng
  if (!Array.isArray(opkPubs) || opkPubs.length === 0) {
    return res.status(400).json({ error: 'opkPubs phải là mảng không rỗng' });
  }

  // Kiểm tra user đã có key bundle chưa — không có thì không thể thêm OPK
  const existing = await prisma.keyBundle.findUnique({
    where: { userId: req.user.userId },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Chưa có key bundle, hãy gọi /upload trước' });
  }

  const currentCount = existing.opkPubs.length; // số OPK còn lại trong DB

  // Nếu đã đủ MAX_OPK thì từ chối — không cần thêm
  if (currentCount >= MAX_OPK) {
    return res.status(400).json({
      error: `Đã có ${currentCount} OPK, không cần thêm`,
      current: currentCount,
    });
  }

  // Chỉ thêm vừa đủ để đạt MAX_OPK — cắt bớt nếu client gửi thừa
  // Ví dụ: còn 30, MAX=100 → chỉ nhận thêm 70, dù client gửi 100
  const canAdd = MAX_OPK - currentCount;
  const toAdd  = opkPubs.slice(0, canAdd);

  // push: thêm vào CUỐI mảng, giữ nguyên các OPK cũ chưa dùng
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
});

// ─── POST /keys/spk ──────────────────────────────────────────────────────────
// Alice gọi định kỳ (vài tuần/tháng) để rotate SPK — chỉ thay spkPub + spkSig
// IK và OPK giữ nguyên, các session cũ không bị ảnh hưởng
router.post('/spk', requireAuth, async (req, res) => {

  const { spkPub, spkSig } = req.body;

  // Validate: phải có đủ 2 trường
  if (!spkPub || !spkSig) {
    return res.status(400).json({ error: 'Thiếu spkPub hoặc spkSig' });
  }

  // Kiểm tra user đã có key bundle chưa
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
});

module.exports = router; // export để server.js có thể import
