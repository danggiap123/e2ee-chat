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
| **PostgreSQL 16** | ACID transactions, `@@unique` composite index, JSON columns (`opkPubs`) |
| **Redis 7** | In-memory key-value với native TTL → hoàn hảo cho JWT blocklist |
| **jsonwebtoken** | JWT sign/verify, `expiresIn:'7d'`, chuẩn RFC 7519 |
| **bcrypt (cost=12)** | Hash password, ~250ms/hash → brute-force khó |
| **ws v8** | WebSocket server thuần Node.js, không cần Socket.io |

### Frontend

| Công nghệ | Lý do chọn |
|---|---|
| **React 18** | Component model, hooks, Context API cho auth state |
| **Vite v6** | Build tool nhanh, HMR instant, không cần webpack config phức tạp |
| **Tailwind CSS v4** | Utility-first, không viết CSS file riêng |
| **libsodium-wrappers** | Binding JS của libsodium C: Ed25519, X25519, crypto_box |
| **Web Crypto API** | AES-256-GCM, HKDF, PBKDF2, SHA-512 — built-in browser, không cần bundle |
| **Dexie.js v4** | Wrapper IndexedDB với Promise/async API |
| **react-router-dom v7** | SPA routing: `/login`, `/register`, `/chat` |

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
// Tìm email trong whitelist — chưa được dùng
const allowed = await prisma.allowedEmail.findFirst({
  where: { email, usedAt: null }
  // usedAt: null = chưa ai đăng ký với email này
});
if (!allowed) return res.status(403)...

// Dùng $transaction để đảm bảo tính nhất quán
// Hoặc cả hai thành công, hoặc cả hai fail — không có trạng thái dở dang
const user = await prisma.$transaction(async (tx) => {
  await tx.allowedEmail.update({
    where: { id: allowed.id },
    data: { usedAt: new Date() }   // đánh dấu email đã dùng
  });
  return tx.user.create({ data: { username, email, passwordHash } });
});

// KHÔNG tạo JWT ở đây
// Response chỉ trả: { userId, message: 'Đăng ký thành công...' }
```

### `routes/auth.js` — POST /auth/login

```javascript
// Timing Attack Protection
const DUMMY_HASH = '$2b$12$invalidhashfortimingatk';
const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
// user?.passwordHash: nếu user tồn tại → dùng hash thật
// ?? DUMMY_HASH: nếu user không tồn tại → vẫn tốn ~250ms bcrypt
// → thời gian response như nhau dù username đúng hay sai

// JWT tạo tại đây — không phải đăng ký
const token = jwt.sign(
  { userId: user.id, username: user.username },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);
return res.json({ token, userId: user.id, username: user.username });
```

### `routes/auth.js` — POST /auth/logout

```javascript
const token = req.headers.authorization.split(' ')[1];
const decoded = jwt.decode(token);  // decode không verify (đã verify ở requireAuth)
const ttl = decoded.exp - Math.floor(Date.now() / 1000); // giây còn lại

if (ttl > 0) {
  await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
  // 'EX' ttl: Redis tự xóa key sau ttl giây
  // Không lưu mãi mãi → tiết kiệm bộ nhớ
}
```

---

### `routes/keys.js` — POST /keys/upload

```javascript
router.post('/upload', requireAuth, async (req, res) => {
// requireAuth: jwt.verify(token) trước → đảm bảo có JWT hợp lệ
// Gọi lúc login() — không phải register()

  const existing = await prisma.keyBundle.findUnique({
    where: { userId: req.user.userId },
  });
  if (existing) {
    return res.status(409).json({ error: 'Key bundle đã tồn tại...' });
    // AuthContext.login() bắt lỗi này:
    // if (!err.message.startsWith('Key bundle đã tồn tại')) throw err;
    // → 409 được bỏ qua silently, không phải lỗi thật
  }
```

### `routes/keys.js` — GET /keys/:userId (Pop OPK)

```javascript
const [firstOpk, ...remainingOpks] = bundle.opkPubs;

await prisma.keyBundle.update({
  where: { userId: req.params.userId },
  data: { opkPubs: remainingOpks },  // lưu lại array không có phần tử đầu
});
// OPK bị pop ngay lập tức → không ai khác dùng cùng OPK
// OPK_priv tương ứng vẫn còn trong IndexedDB của Bob → dùng để X3DH receiver
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
// Nếu IV trùng trong cùng conversation → Prisma throw P2002 → server trả 409
// Tại sao bảo vệ được? Attacker replay ciphertext cũ phải dùng IV cũ
// → IV trùng → server từ chối
```

---

### `routes/conversations.js` — PATCH /fingerprint

```javascript
// Chỉ set true, không bao giờ cho unverify
if (conversation.fingerprintVerified) {
  return res.json({ message: 'Fingerprint đã được xác nhận trước đó' });
  // Idempotent: gọi nhiều lần không gây lỗi
}
await prisma.conversation.update({
  where: { id: convId },
  data: { fingerprintVerified: true },
});
// Frontend: MessageInput disabled={!fingerprintVerified}
// → user bắt buộc phải verify trước khi chat
```

---

## 3. Giải Thích Code Frontend

### `AuthContext.jsx` — register()

```javascript
async function register(usernameInput, password, email) {
  await sodium.ready;  // WASM cần init async

  // Sinh key — chưa cần mạng
  const { IK_pub, IK_secret } = await generateIdentityKey();
  const { SPK_priv }          = await generateSignedPreKey(IK_secret);
  const opkList               = await generateOneTimePreKeys(100);

  const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
  const wKey     = await deriveWrappingKey(password, wrapSalt); // ~1 giây

  // Gọi server — chỉ tạo user, KHÔNG upload key
  const { userId } = await api.register(usernameInput, password, email);

  // Lưu IndexedDB — server không thấy bước này
  await storage.savePrivateKeys(userId, wrapSalt, wKey, IK_secret, SPK_priv, opkList);

  // Không setToken, không navigate — caller (Register.jsx) tự navigate('/login')
}
```

### `AuthContext.jsx` — login()

```javascript
async function login(usernameInput, password) {
  // Bước 1: lấy JWT từ server
  const { token: t, userId: uid, username: uname } = await api.login(usernameInput, password);

  // Bước 2: kiểm tra thiết bị
  const hasKeys = await storage.hasPrivateKeys(uid);
  if (!hasKeys) throw new Error('DEVICE_NOT_REGISTERED');
  // Login.jsx bắt lỗi này → hiển thị hướng dẫn import .e2ee

  // Bước 3: derive wrappingKey
  const wrapSalt = await storage.getWrapSalt(uid);
  const wKey     = await deriveWrappingKey(password, wrapSalt); // ~1 giây

  // Bước 4: unwrap keys (password sai → throw ở đây)
  const keys = await storage.loadPrivateKeys(uid, wKey);

  // Bước 5: tính lại public keys từ private keys (deterministic)
  const SPK_pub = sodium.crypto_scalarmult_base(keys.SPK_priv);
  const spkSig  = sodium.crypto_sign_detached(SPK_pub, keys.IK_secret);
  const opkPubs = [...keys.opkMap.entries()].map(([id, priv]) => ({
    id,
    pub: toBase64(sodium.crypto_scalarmult_base(priv)),
  }));
  // Tại sao tính lại thay vì lưu pub key riêng?
  // X25519: public = scalar_mult(private, basepoint) → deterministic
  // → không cần lưu thêm pub key, tiết kiệm storage

  // Bước 6: upload public key lên server (có JWT rồi nên được)
  try {
    await api.uploadKeys(t, { ikPub: toBase64(keys.IK_pub), spkPub: toBase64(SPK_pub), spkSig: toBase64(spkSig), opkPubs });
  } catch (err) {
    if (!err.message.startsWith('Key bundle đã tồn tại')) throw err;
    // 409 = đã upload lần trước → bỏ qua
  }

  // Bước 7: lưu state
  localStorage.setItem('token', t);
  localStorage.setItem('userId', uid);
  localStorage.setItem('username', uname);
  setToken(t); setUserId(uid); setUsername(uname);
  setWrappingKey(wKey); setIKSecret(keys.IK_secret);
  setIKPub(keys.IK_pub); setSPKPriv(keys.SPK_priv);
  // isAuthenticated tự chuyển true → Login.jsx useEffect → navigate('/chat')
}
```

### `Chat.jsx` — getOrCreateSK()

```javascript
async function getOrCreateSK(convId, peerId) {
  // 1. RAM cache (nhanh nhất)
  const cached = sessionKeysRef.current.get(convId);
  if (cached) return cached;

  // 2. IndexedDB (không cần X3DH)
  const stored = await storage.loadSession(convId, wrappingKey);
  if (stored) {
    sessionKeysRef.current.set(convId, stored);
    return stored;
  }

  // 3. X3DH — chỉ chạy lần đầu tiên của mỗi conversation
  const bobBundle = await api.fetchKeyBundle(token, peerId);
  const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
    { IK_secret, IK_pub }, bobBundle
  );

  await storage.saveSession(convId, SK, wrappingKey);
  sessionKeysRef.current.set(convId, SK);

  // isFirstMessage = true → gửi kèm ekPub, OPK_id, ikPub
  setIsFirstMessageMap(prev => ({ ...prev, [convId]: { EK_pub, OPK_id, IK_pub: myIKPub } }));
  return SK;
}
```

---

## 4. Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data  # persist qua restart

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    # --appendonly yes: AOF persistence
    # → JWT blocklist không mất khi Redis restart
    # → Người đã logout không thể dùng lại token cũ

  backend:
    build: ./backend
    depends_on: [postgres, redis]
    # depends_on: đảm bảo postgres và redis khởi động trước
    # Nếu không: backend connect fail → crash → Docker restart loop
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/e2ee
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "3000:3000"
```
