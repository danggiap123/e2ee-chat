# Cài Đặt Chi Tiết — Framework & Giải Thích Code
> Viết theo đúng code thực tế

---

## 1. Technology Stack

### Backend

| Công nghệ | Lý do chọn |
|---|---|
| **Node.js** | Event-loop non-blocking — phù hợp I/O-heavy (WebSocket relay) |
| **Express.js v5** | Framework HTTP minimalist, dễ mount route và middleware |
| **Prisma v6** | ORM type-safe, migration tự động, `$transaction()` tường minh |
| **PostgreSQL 16** | ACID transactions, `@@unique` composite index, JSON columns (`opkPubs`), `FOR UPDATE` row lock |
| **Redis 7** | In-memory key-value với native TTL → hoàn hảo cho JWT blocklist |
| **jsonwebtoken** | JWT sign/verify, `expiresIn:'7d'`, chuẩn RFC 7519 |
| **bcrypt (cost=12)** | Hash password, ~250ms/hash → brute-force khó |
| **ws v8** | WebSocket server thuần Node.js, không cần Socket.io |
| **multer** | Middleware upload file (memoryStorage → ghi disk bằng UUID) |

### Frontend

| Công nghệ | Lý do chọn |
|---|---|
| **React 18** | Component model, hooks, Context API cho auth state |
| **Vite v6** | Build tool nhanh, HMR instant, proxy dev server |
| **Tailwind CSS v4** | Utility-first, không viết CSS file riêng |
| **libsodium-wrappers** | Binding JS của libsodium C: Ed25519, X25519, crypto_box |
| **Web Crypto API** | AES-256-GCM, HKDF, PBKDF2, SHA-512 — built-in browser, không cần bundle |
| **Dexie.js v4** | Wrapper IndexedDB với Promise/async API |
| **react-router-dom v7** | SPA routing: `/login`, `/register`, `/chat`, `/admin` |

**Tại sao libsodium + Web Crypto API (2 thư viện)?**
- `libsodium`: Ed25519 sign/verify, X25519 DH (`crypto_scalarmult`), convert Ed25519↔X25519. Web Crypto API không có X25519 DH.
- `Web Crypto API`: AES-GCM, HKDF, PBKDF2, SHA-512. Native browser, không tốn bundle size.

**Tại sao KHÔNG dùng localStorage cho private key?**
- localStorage: synchronous, giới hạn 5MB, lưu string plaintext
- IndexedDB (Dexie): async, không giới hạn thực tế, lưu binary (Uint8Array), có thể lưu wrapped ciphertext

---

## 2. Giải Thích Code Backend

### `server.js` — Entry Point

```javascript
const server = http.createServer(app);
// Tại sao không dùng app.listen() trực tiếp?
// WebSocket cần gắn vào http.Server để share cổng với REST
// app.listen() tạo http.Server mới bên trong, không trả ra ngoài
// → WS không gắn được
// Giải pháp: tạo http.Server thủ công → truyền vào cả Express và WS

initWebSocket(server);
// Sau dòng này: cổng 3000 phục vụ cả REST và WS
// Node.js phân biệt qua header "Upgrade: websocket"
```

---

### `routes/auth.js` — POST /auth/register

```javascript
// ADMIN_SEED_EMAIL bypass: email đặc biệt bỏ qua whitelist + nhận role ADMIN
const isAdminSeed = email === process.env.ADMIN_SEED_EMAIL;

if (!isAdminSeed) {
  const allowed = await prisma.allowedEmail.findFirst({
    where: { email, usedAt: null }
  });
  if (!allowed) return res.status(403)...
}

const user = await prisma.$transaction(async (tx) => {
  if (!isAdminSeed) {
    await tx.allowedEmail.update({ where: { id: allowed.id }, data: { usedAt: new Date() } });
  }
  return tx.user.create({
    data: { username, email, passwordHash, role: isAdminSeed ? 'ADMIN' : 'USER' }
  });
});

// KHÔNG tạo JWT ở đây — response chỉ trả { userId, message }
```

### `routes/auth.js` — POST /auth/login

```javascript
// Kiểm tra isActive trước khi compare password
// (timing attack vẫn được bảo vệ vì bcrypt.compare chạy dù user không tồn tại)
const DUMMY_HASH = '$2b$12$invalidhashfortimingatk';
const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
if (!isValid || !user || !user.isActive) {
  return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  // isActive=false: cùng message → attacker không phân biệt được lý do từ chối
}

// JWT mang thêm role — FE dùng để hiện icon ⚙ admin
const token = jwt.sign(
  { userId: user.id, username: user.username, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);
return res.json({ token, userId: user.id, username: user.username, role: user.role });
```

### `routes/auth.js` — POST /auth/logout

```javascript
const token = req.headers.authorization.split(' ')[1];
const decoded = jwt.decode(token);
const ttl = decoded.exp - Math.floor(Date.now() / 1000);
if (ttl > 0) {
  await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
  // Redis tự xóa key sau ttl giây → tiết kiệm bộ nhớ
}
```

---

### `middleware/auth.js` — Thêm check isActive

```javascript
export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  // Kiểm tra JWT blocklist (logout)
  const blocked = await redis.get(`blocklist:${token}`);
  if (blocked) return res.status(401)...

  // Kiểm tra isActive (vô hiệu hóa bởi admin)
  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });

  req.user = { ...decoded, isActive: user.isActive };
  next();
}
```

---

### `routes/admin.js` — Race Condition Protection

```javascript
// Vấn đề: 2 admin A và B cùng lúc thu hồi quyền nhau
// Cả 2 đều thấy adminCount=2 → cả 2 đều pass → hệ thống không còn admin
//
// Giải pháp: FOR UPDATE lock row trong PostgreSQL transaction
router.patch('/users/:id/revoke-admin', requireAuth, requireAdminRole, async (req, res) => {
  await prisma.$transaction(async (tx) => {
    // FOR UPDATE: PostgreSQL lock toàn bộ admin rows
    // Request thứ 2 phải đợi request thứ 1 commit xong mới chạy tiếp
    await tx.$executeRaw`SELECT id FROM "User" WHERE role='ADMIN' FOR UPDATE`;
    const adminCount = await tx.user.count({ where: { role: 'ADMIN' } });
    if (adminCount <= 1) throw new Error('LAST_ADMIN');
    await tx.user.update({ where: { id: req.params.id }, data: { role: 'USER' } });
  });
});
```

---

### `routes/keys.js` — GET /keys/:userId (Pop OPK)

```javascript
const [firstOpk, ...remainingOpks] = bundle.opkPubs;
await prisma.keyBundle.update({
  where: { userId: req.params.userId },
  data: { opkPubs: remainingOpks },
});
// OPK bị pop ngay lập tức → không ai khác dùng cùng OPK
// OPK_priv tương ứng vẫn còn trong IndexedDB của Bob
```

---

### `routes/messages.js` — Group Message: N Bản Mã Song Song

```javascript
// POST /messages: xử lý cả 1-1 lẫn group
if (groupId) {
  // Nhận mảng recipients [{recipientId, ciphertext, iv, aad, ekPub?, opkId?, ikPub?}]
  const insertedMessages = await Promise.all(
    recipients.map(r =>
      prisma.message.create({
        data: {
          groupId,
          senderId: req.user.userId,
          recipientId: r.recipientId,
          ciphertext: r.ciphertext,
          iv: r.iv,
          aad: r.aad,
          ekPub: r.ekPub || null,
          opkId: r.opkId || null,
          ikPub: r.ikPub || null,
        }
      })
    )
  );
  // Relay: gửi đến từng recipient qua WebSocket
  for (const msg of insertedMessages) {
    const recipientWs = clients.get(msg.recipientId);
    if (recipientWs) safeSend(recipientWs, { type: 'group_message', ...msg });
  }
}
```

---

### `routes/messages.js` — Replay Attack Protection

```javascript
} catch (err) {
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Phát hiện tấn công phát lại' });
  }
// P2002 = Prisma unique constraint violation
// Schema có: @@unique([conversationId, iv])
// Attacker replay ciphertext cũ → IV trùng → P2002 → 409
```

---

### `routes/files.js` — Upload File E2EE

```javascript
const upload = multer({
  storage: multer.memoryStorage(),  // giữ file trong RAM trước
  limits: { fileSize: 10 * 1024 * 1024 }  // 10MB
});

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const fileId = crypto.randomUUID();  // tên file ngẫu nhiên, không đoán được
  const filePath = path.join(__dirname, '../uploads', fileId);
  await fs.promises.writeFile(filePath, req.file.buffer);
  // Ghi encrypted bytes — server không biết nội dung

  await prisma.uploadedFile.create({
    data: { id: fileId, uploaderId: req.user.userId }
  });

  res.json({ fileId });
});

router.get('/:fileId', requireAuth, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads', req.params.fileId);
  res.sendFile(path.resolve(filePath));  // trả encrypted bytes nguyên xi
});
```

---

### `routes/peers.js` — Verify Peer (Global)

```javascript
router.patch('/:peerId/verify', requireAuth, async (req, res) => {
  const { peerId } = req.params;
  const verifierId = req.user.userId;

  if (verifierId === peerId) return res.status(400).json({ error: 'Không thể tự verify mình' });

  const peer = await prisma.user.findUnique({ where: { id: peerId } });
  if (!peer) return res.status(404)...

  await prisma.peerVerification.upsert({
    where: { verifierId_peerId: { verifierId, peerId } },
    update: { verifiedAt: new Date() },
    create: { verifierId, peerId },
  });
  // upsert: gọi nhiều lần không tạo trùng → idempotent
  res.json({ message: 'Đã xác minh' });
});
```

---

### `routes/conversations.js` — PATCH /fingerprint (Đồng bộ 1-1 ↔ Group)

```javascript
// Dùng $transaction: cả 2 thao tác thành công hoặc cả 2 thất bại
await prisma.$transaction([
  prisma.conversation.update({
    where: { id: convId },
    data: { fingerprintVerified: true },
  }),
  prisma.peerVerification.upsert({
    where: { verifierId_peerId: { verifierId: myId, peerId } },
    update: { verifiedAt: new Date() },
    create: { verifierId: myId, peerId },
  }),
]);
// → verify 1-1 tự động được nhận diện ở GroupInfoPanel (isVerifiedByMe=true)
```

---

## 3. Giải Thích Code Frontend

### `AuthContext.jsx` — register()

```javascript
async function register(usernameInput, password, email) {
  await sodium.ready;

  const { IK_pub, IK_secret } = await generateIdentityKey();
  const { SPK_priv }          = await generateSignedPreKey(IK_secret);
  const opkList               = await generateOneTimePreKeys(100);

  const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
  const wKey     = await deriveWrappingKey(password, wrapSalt); // ~1 giây

  // Gọi server — chỉ tạo user, KHÔNG upload key
  const { userId } = await api.register(usernameInput, password, email);

  // Lưu IndexedDB — server không thấy bước này
  await storage.savePrivateKeys(userId, wrapSalt, wKey, IK_secret, SPK_priv, opkList);
}
```

### `AuthContext.jsx` — login()

```javascript
async function login(usernameInput, password) {
  const { token: t, userId: uid, username: uname, role: r } = await api.login(usernameInput, password);

  const hasKeys = await storage.hasPrivateKeys(uid);
  if (!hasKeys) throw new Error('DEVICE_NOT_REGISTERED');

  const wrapSalt = await storage.getWrapSalt(uid);
  const wKey     = await deriveWrappingKey(password, wrapSalt); // ~1 giây
  const keys     = await storage.loadPrivateKeys(uid, wKey);   // password sai → throw

  // Tính lại public keys từ private keys (deterministic)
  const SPK_pub = sodium.crypto_scalarmult_base(keys.SPK_priv);
  const spkSig  = sodium.crypto_sign_detached(SPK_pub, keys.IK_secret);
  // ...

  try {
    await api.uploadKeys(t, { ikPub, spkPub, spkSig, opkPubs });
  } catch (err) {
    if (!err.message.startsWith('Key bundle đã tồn tại')) throw err;
    // 409 = login lần 2 trở đi → bỏ qua
  }

  localStorage.setItem('role', r);
  setRole(r); setToken(t); /* ... */
}
```

### `Chat.jsx` — getOrCreateSK() và getOrCreateGroupSK()

```javascript
// 1-1: cache key = convId
async function getOrCreateSK(convId, peerId) {
  const cached = sessionKeysRef.current.get(convId);
  if (cached) return cached;

  const stored = await storage.loadSession(convId, wrappingKey);
  if (stored) { sessionKeysRef.current.set(convId, stored); return stored; }

  // Lần đầu: thực hiện X3DH sender
  const bobBundle = await api.fetchKeyBundle(token, peerId);
  const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
    { IK_secret, IK_pub }, bobBundle
  );
  await storage.saveSession(convId, SK, wrappingKey);
  sessionKeysRef.current.set(convId, SK);
  setIsFirstMessageMap(prev => ({ ...prev, [convId]: { EK_pub, OPK_id, IK_pub: myIKPub } }));
  return SK;
}

// Group: cache key = "${groupId}:${recipientId}"
async function getOrCreateGroupSK(groupId, recipientId) {
  const cacheKey = `${groupId}:${recipientId}`;
  const cached = sessionKeysRef.current.get(cacheKey);
  if (cached) return cached;
  // ... tương tự, nhưng X3DH với từng thành viên
}
```

### `Chat.jsx` — handleSendFile() và handleSendGroupFile()

```javascript
// 1-1: mã hóa bằng SK conversation
async function handleSendFile(file) {
  const SK = await getOrCreateSK(activeConvId, activeConv.peer.id);
  const { encryptedBytes, fileIv } = await encryptBytes(fileBytes, SK);
  const { fileId } = await api.uploadFile(token, encryptedBytes);
  const payload = { type: isImage ? 'image' : 'file', fileId, fileName, mimeType, fileSize, fileIv };
  // Gửi payload JSON mã hóa như tin nhắn thường
  await sendEncryptedMessage(JSON.stringify(payload));
}

// Group: random fileKey, upload 1 lần, gửi fileKey trong payload từng người
async function handleSendGroupFile(file) {
  const { encryptedBytes, fileIv, fileKey } = await encryptBytesWithRandomKey(fileBytes);
  const { fileId } = await api.uploadFile(token, encryptedBytes);
  const recipients = await Promise.all(
    activeGroup.members
      .filter(m => m.id !== userId)
      .map(async m => {
        const SK = await getOrCreateGroupSK(activeGroup.id, m.id);
        const payload = { type, fileId, fileName, mimeType, fileSize, fileIv, fileKey };
        const { ciphertext, iv, aad } = await encryptMessage(JSON.stringify(payload), SK, ...);
        return { recipientId: m.id, ciphertext, iv, aad };
      })
  );
  await api.sendGroupMessage(token, activeGroup.id, recipients);
}
```

---

## 4. Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    # --appendonly yes: AOF persistence
    # → JWT blocklist không mất khi Redis restart
    # → Người đã logout không thể dùng lại token cũ

  backend:
    build: ./backend
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/e2ee
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      ADMIN_SEED_EMAIL: ${ADMIN_SEED_EMAIL}
      # ADMIN_SEED_EMAIL: email bypass whitelist, tự nhận role ADMIN khi đăng ký
      # Sau khi đăng ký xong → biến này vô tác dụng (email đã có trong DB)
    volumes:
      - uploads_data:/app/uploads  # file E2EE tồn tại qua container restart
    ports:
      - "3000:3000"

  frontend:
    build: ./frontend
    # Multi-stage: Vite build → Nginx serve static
    # nginx.conf: reverse proxy /api → backend:3000, /ws WebSocket, SPA fallback

volumes:
  postgres_data:
  redis_data:
  uploads_data:  # QUAN TRỌNG: không có volume này → file mất khi restart container
```

### Vite Proxy (`frontend/vite.config.js`)

```javascript
server: {
  proxy: {
    '/api': { target: 'http://localhost:3000', rewrite: path => path.replace(/^\/api/, '') },
    '/ws':  { target: 'ws://localhost:3000', ws: true, rewrite: path => path.replace(/^\/ws/, '') }
  }
}
// Tránh CORS issue khi dev: browser thấy cùng origin (localhost:5173)
// Nginx trong production làm việc tương tự
```

---

## 5. Luồng Truy Cập Admin

```
User → ChatSidebar → icon ⚙ (visible nếu role=ADMIN)
     → navigate('/admin')  ← SPA navigation (không reload)
     → App.jsx: AdminRoute guard
         ├── !isAuthenticated → redirect /login
         ├── role !== 'ADMIN' → redirect /chat
         └── OK → render Admin.jsx

Tại sao SPA navigation, không phải <a href="/admin">?
  Reload → wrappingKey mất khỏi RAM → về /chat sẽ trigger UnlockModal
  SPA → React state giữ nguyên → wrappingKey còn trong RAM
  → quay lại /chat không cần nhập lại mật khẩu

Gõ thẳng /admin sau reload:
  wrappingKey = null → AdminRoute redirect /chat → isLocked=true → UnlockModal
  Đây là đúng về bảo mật: buộc nhập mật khẩu để có wrappingKey
```
