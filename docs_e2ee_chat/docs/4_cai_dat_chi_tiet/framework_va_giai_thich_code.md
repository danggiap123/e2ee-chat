# Cài Đặt Chi Tiết — Framework & Giải Thích Code

---

## 1. Framework & Technology Stack

### Backend

| Công nghệ | Phiên bản | Lý do chọn |
|---|---|---|
| **Node.js** | v24 | Runtime JS, event-loop non-blocking phù hợp I/O-heavy (WebSocket) |
| **Express.js** | ^5 | Framework HTTP minimalist, dễ mount route, dễ giải thích |
| **Prisma** | ^6 | ORM type-safe, migration tự động, query builder tường minh |
| **PostgreSQL** | 16 | ACID transactions, composite index, JSON columns (`opkPubs`) |
| **Redis** | 7 | Key-value in-memory, TTL native → hoàn hảo cho JWT blocklist |
| **jsonwebtoken** | ^9 | Ký và verify JWT, chuẩn RFC 7519 |
| **bcrypt** | ^5 | Hash password, cost factor, chống brute-force |
| **ws** | ^8 | WebSocket server thuần JS, lightweight, không phụ thuộc Socket.io |
| **Docker Compose** | v3.8 | Đóng gói PostgreSQL + Redis + Backend, chạy 1 lệnh |

### Frontend

| Công nghệ | Phiên bản | Lý do chọn |
|---|---|---|
| **React** | 18 | Component model, hooks, Context API |
| **Vite** | ^6 | Build tool nhanh hơn webpack 10-100×, HMR instant |
| **Tailwind CSS** | v4 | Utility-first, không viết CSS file riêng, responsive dễ |
| **libsodium-wrappers** | ^0.7 | Binding JS của libsodium C — Ed25519, X25519, crypto_box |
| **Web Crypto API** | Native | AES-256-GCM, HKDF, PBKDF2, SHA-512 — built-in browser |
| **Dexie.js** | ^4 | Wrapper IndexedDB với Promise/async API |
| **react-router-dom** | ^7 | SPA routing: `/login`, `/register`, `/chat` |

**Tại sao libsodium + Web Crypto API (2 thư viện crypto)?**
- **libsodium**: cần cho Ed25519 (ký/verify SPK) và X25519 (DH — `crypto_scalarmult`). Web Crypto API không có X25519 DH trực tiếp.
- **Web Crypto API**: dùng cho AES-GCM, HKDF, PBKDF2, SHA-512. Browser API native, không cần bundle thêm.
- Tách biệt rõ ràng: libsodium cho asymmetric crypto, Web Crypto cho symmetric.

---

## 2. Cấu Trúc File & Entry Points

### Backend — `server.js`

```javascript
require('dotenv').config();
// ↑ Phải là dòng đầu tiên để load .env trước khi bất kỳ module nào dùng
//   process.env.JWT_SECRET, DATABASE_URL, REDIS_URL

const http = require('http');
// ↑ Core Node.js HTTP module
//   Cần để tạo http.Server — WebSocket phải gắn vào http.Server
//   Nếu dùng app.listen() trực tiếp → WebSocket không thể share cổng

const server = http.createServer(app);
// ↑ Bọc Express app trong http.Server
//   Request HTTP thường → Express xử lý
//   Request WebSocket (có header "Upgrade: websocket") → WebSocket server xử lý
//   Cả 2 dùng chung cổng 3000

initWebSocket(server);
// ↑ Gắn WebSocket server vào http.Server
//   Từ đây server lắng nghe cả REST và WS trên cùng 1 cổng
```

---

## 3. Giải Thích API Endpoints

### Auth Routes (`auth.js`)

#### `POST /auth/register`

```javascript
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Validate độ dài password — phòng thủ tầng server
  // Frontend cũng validate nhưng không đủ vì có thể bypass
  if (!username || !password || password.length < 8) { ... }

  // Kiểm tra email whitelist doanh nghiệp
  const allowed = await prisma.allowedEmail.findFirst({
    where: { email, usedAt: null }
    //             ↑ usedAt: null = chưa ai dùng email này
  });
  if (!allowed) return res.status(403)...

  // Hash password BCrypt cost=12
  // cost=12 → 2^12 = 4096 vòng → ~250ms/hash
  const passwordHash = await bcrypt.hash(password, 12);

  // Tạo user và đánh dấu email đã dùng trong 1 transaction
  const user = await prisma.$transaction(async (tx) => {
    await tx.allowedEmail.update({
      where: { id: allowed.id },
      data: { usedAt: new Date() }
    });
    return tx.user.create({ data: { username, email, passwordHash } });
  });
  // ↑ Transaction đảm bảo: hoặc cả 2 thành công, hoặc cả 2 fail
  //   Không có trường hợp user được tạo mà email chưa đánh dấu

  // Tạo JWT 7 ngày
  const token = jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
});
```

#### `POST /auth/login` — Timing Attack Protection

```javascript
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = await prisma.user.findUnique({ where: { username } });

  // TIMING ATTACK PROTECTION:
  // Nếu user không tồn tại và ta return sớm → response nhanh hơn
  // Kẻ tấn công so sánh thời gian response để biết username tồn tại hay không
  //
  // Giải pháp: dù user không tồn tại, vẫn gọi bcrypt.compare() với hash giả
  // → thời gian response luôn ~250ms dù user có tồn tại hay không
  const DUMMY_HASH = '$2b$12$invalidhashfortimingatk';
  const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !isValid) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    // ↑ Cùng 1 message cho cả 2 trường hợp → kẻ tấn công không biết cái nào sai
  }
});
```

#### `POST /auth/logout` — Redis Blocklist

```javascript
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];

  // Tính TTL còn lại của token → blocklist hết hạn cùng lúc token hết hạn
  // Không lưu mãi mãi → tiết kiệm bộ nhớ Redis
  const decoded = jwt.decode(token);
  const ttl = decoded.exp - Math.floor(Date.now() / 1000);

  if (ttl > 0) {
    await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
    // ↑ "EX ttl" = TTL tính theo giây
  }
});
```

---

### Keys Routes (`keys.js`)

#### `GET /keys/:userId` — Pop OPK

```javascript
router.get('/:userId', requireAuth, async (req, res) => {
  const bundle = await prisma.keyBundle.findUnique({
    where: { userId: req.params.userId }
  });

  if (!bundle || bundle.opkPubs.length === 0) {
    return res.status(410).json({ error: 'Hết OPK' });
    // ↑ 410 Gone — theo X3DH spec: nếu hết OPK thì bỏ DH4
    //   Vẫn hoạt động nhưng mất 1 tầng forward secrecy
  }

  // Pop 1 OPK đầu tiên khỏi pool
  const [firstOpk, ...remainingOpks] = bundle.opkPubs;
  await prisma.keyBundle.update({
    where: { id: bundle.id },
    data: { opkPubs: remainingOpks }  // lưu lại mảng đã bỏ phần tử đầu
  });

  // Nếu còn < 10 OPK → thông báo client bổ sung
  if (remainingOpks.length < 10) {
    const receiverSocket = clients.get(req.params.userId);
    if (receiverSocket?.readyState === WebSocket.OPEN) {
      receiverSocket.send(JSON.stringify({ type: 'low_opk', remaining: remainingOpks.length }));
    }
  }

  return res.json({
    ikPub:  bundle.ikPub,
    spkPub: bundle.spkPub,
    spkSig: bundle.spkSig,
    opkPub: firstOpk.pub,    // ← chỉ public key — server không có private key
    opkId:  firstOpk.id,     // ← Bob cần ID này để tìm OPK_priv trong IndexedDB
  });
});
```

---

### Messages Routes (`messages.js`)

#### `POST /messages` — Direct Message

```javascript
async function handleDirectMessage(req, res) {
  const { conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub } = req.body;
  // ekPub, opkId, ikPub: chỉ có ở tin X3DH đầu tiên, null ở mọi tin còn lại

  // Kiểm tra membership — IDOR prevention
  const isMember = conversation.participantA === req.user.userId ||
                   conversation.participantB === req.user.userId;
  if (!isMember) return res.status(403)...
  // ↑ IDOR = Insecure Direct Object Reference
  //   Không check: user có thể gửi tin vào conversation người khác
  //   bằng cách đoán UUID

  // Lưu DB trước — không mất tin khi server crash giữa chừng
  const message = await prisma.message.create({
    data: { conversationId, senderId: req.user.userId, ciphertext, iv, aad,
            ekPub: ekPub ?? null, opkId: opkId ?? null, ikPub: ikPub ?? null }
  });

  // Relay qua in-memory Map
  const receiverWs = clients.get(receiverId);
  if (receiverWs?.readyState === WebSocket.OPEN) {
    receiverWs.send(JSON.stringify({
      type: 'message', msgId: message.id, ...payload
    }));
  }
  // Nếu receiver offline → bỏ qua relay, tin đã lưu DB → tự tải lịch sử khi online
}
```

#### `GET /messages/:convId` — Cursor Pagination

```javascript
router.get('/:convId', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  // ↑ Giới hạn tối đa 100 — tránh client request 10000 tin 1 lúc

  const cursor = req.query.cursor;  // undefined khi load lần đầu

  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: 'desc' },  // mới nhất trước
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    // ↑ cursor: bắt đầu từ tin có id = cursor
    //   skip: 1 — bỏ qua chính cursor (tránh hiển thị trùng)
    //   Không có cursor → load 20 tin mới nhất
  });

  const nextCursor = messages.length === limit
    ? messages[messages.length - 1].id
    : null;
  // ↑ nextCursor = null khi không còn tin trước đó (đã tới đầu lịch sử)
  //   hasMore = false → không hiển thị nút "Tải thêm"
});
```

---

### WebSocket Handler (`handler.js`)

#### `broadcast(payload, excludeUserId)`

```javascript
function broadcast(payload, excludeUserId) {
  const data = JSON.stringify(payload);
  for (const [uid, socket] of clients.entries()) {
    if (uid === excludeUserId) continue;  // không gửi lại cho chính mình
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}
// Dùng cho: presence events (user vừa online/offline)
// Tại sao dùng cho presence: tất cả client cần biết ai online
```

#### `safeSend(ws, payload)`

```javascript
function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
// Tại sao cần hàm này?
// ws.send() throw nếu socket đã đóng (CLOSING/CLOSED)
// safeSend check readyState trước → không crash server
```

#### Single-session policy

```javascript
const existing = clients.get(userId);
if (existing && existing.readyState === WebSocket.OPEN) {
  safeSend(existing, { type: 'session_replaced' });
  existing.close(4009, 'Replaced by new connection');
}
clients.set(userId, ws);
// Tại sao?
// Nếu 2 tab mở cùng lúc → 2 socket cùng userId
// Tin nhắn sẽ đến 1 trong 2 socket ngẫu nhiên → inconsistent state
// Giải pháp đơn giản: đóng socket cũ khi có socket mới
```

---

## 4. Frontend — Hooks Chi Tiết

### `useWebSocket.js` — Xử Lý Tin X3DH Đến

```javascript
async function handleIncoming(msg) {
  // msg = { convId, senderId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }

  let SK = sessionKeysRef.current.get(msg.conversationId);

  if (!SK) {
    if (msg.ekPub && msg.opkId && msg.ikPub) {
      // Đây là tin X3DH đầu tiên → cần tính SK receiver
      const OPK_priv = await storage.getOPK(userIdRef.current, msg.opkId, wrappingKeyRef.current);
      // ↑ Lấy đúng OPK_priv theo opkId — không phải tất cả OPK

      const initMsg = {
        ikPub:  msg.ikPub,   // IK_pub của Alice
        ekPub:  msg.ekPub,   // EK_pub của Alice
      };
      const myKeys = {
        IK_secret: IK_secretRef.current,
        SPK_priv:  SPK_privRef.current,
        OPK_priv,
      };

      const { SK: newSK } = await performX3DH_receiver(myKeys, initMsg);
      // ↑ 4 phép DH ngược → cùng SK với Alice

      await storage.saveSession(msg.conversationId, newSK, wrappingKeyRef.current);
      await storage.deleteOPK(userIdRef.current, msg.opkId);
      // ↑ OPK dùng 1 lần — xóa khỏi IndexedDB để không tái dùng

      sessionKeysRef.current.set(msg.conversationId, newSK);
      SK = newSK;
    } else {
      // Không phải X3DH, không có SK → thử load từ IndexedDB
      SK = await storage.loadSession(msg.conversationId, wrappingKeyRef.current);
      if (SK) sessionKeysRef.current.set(msg.conversationId, SK);
    }
  }

  if (!SK) {
    // Vẫn không có SK → hiển thị lỗi giải mã
    newMsgCallbackRef.current?.({
      ...msg, plaintext: null, decryptError: true
    });
    return;
  }

  const plaintext = await decryptMessage(msg.ciphertext, msg.iv, msg.aad, SK);
  newMsgCallbackRef.current?.({ ...msg, plaintext });
}
```

### `useWebSocket.js` — Stale Closure Problem & Giải Pháp

```javascript
// Vấn đề: React hooks closure "đóng băng" giá trị tại thời điểm effect chạy
// Nếu wrappingKey thay đổi sau khi effect đã đăng ký handler → handler dùng giá trị cũ

// Giải pháp: dùng Ref thay vì trực tiếp dùng state trong handler
const wrappingKeyRef = useRef(wrappingKey);
const IK_secretRef   = useRef(IK_secret);

// Đồng bộ Ref với state — effect chạy mỗi khi state thay đổi
useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
useEffect(() => { IK_secretRef.current   = IK_secret;   }, [IK_secret]);

// Handler đọc từ Ref → luôn có giá trị mới nhất dù effect chỉ đăng ký 1 lần
async function handleIncoming(msg) {
  const key = wrappingKeyRef.current;  // ← không bị stale
  ...
}
```

### `Chat.jsx` — Orchestrator

```javascript
// getOrCreateSK: logic trung tâm quyết định cách lấy Session Key
async function getOrCreateSK(conversationId, peerId) {
  // 1. Check RAM cache (nhanh nhất — không cần async)
  const cached = sessionKeysRef.current.get(conversationId);
  if (cached) return cached;

  // 2. Load từ IndexedDB (chậm hơn RAM nhưng không cần X3DH)
  const stored = await storage.loadSession(conversationId, wrappingKey);
  if (stored) {
    sessionKeysRef.current.set(conversationId, stored);
    return stored;
  }

  // 3. Chưa có session → thực hiện X3DH (chỉ lần đầu tiên của mỗi conversation)
  const bobBundle = await api.fetchKeyBundle(token, peerId);
  const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
    { IK_secret, IK_pub },
    bobBundle
  );

  await storage.saveSession(conversationId, SK, wrappingKey);
  sessionKeysRef.current.set(conversationId, SK);
  return SK;
}

// handleSend: gửi tin nhắn
async function handleSend(text) {
  const SK = await getOrCreateSK(activeConvId, activePeer.id);

  // Optimistic UI: hiển thị tin ngay, không chờ server ack
  const tempMsg = { id: `temp-${Date.now()}`, plaintext: text, senderId: userId, pending: true };
  addMessage(tempMsg);

  const { ciphertext, iv, aad } = await encryptMessage(text, SK, activeConvId, userId);

  sendSocketMessage({
    type: 'message',
    conversationId: activeConvId,
    ciphertext, iv, aad,
    // ekPub, opkId, ikPub chỉ gửi khi đây là tin X3DH đầu tiên
    ...(isFirstMessage ? { ekPub, opkId, ikPub } : {})
  });
}
```

---

## 5. Docker Compose — Triển Khai

```yaml
services:
  postgres:
    image: postgres:16-alpine       # alpine = lightweight, ít lỗ hổng hơn
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}   # từ .env, không hardcode
    volumes:
      - postgres_data:/var/lib/postgresql/data  # persist data qua restart

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes   # AOF persistence — tránh mất blocklist khi restart

  backend:
    build: ./backend
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/e2ee
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "3000:3000"
```

**Tại sao `depends_on`?**
Đảm bảo PostgreSQL và Redis khởi động trước backend. Nếu không có, backend có thể crash vì chưa connect được DB.

**Tại sao Redis `--appendonly yes`?**
Mặc định Redis chỉ lưu snapshot định kỳ. AOF ghi mỗi lệnh → nếu server restart, JWT blocklist không bị mất (người đã logout không thể login lại bằng token cũ).
