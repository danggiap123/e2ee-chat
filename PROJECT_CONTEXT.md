# PROJECT_CONTEXT.md — Toàn bộ ngữ cảnh để viết báo cáo đồ án E2EE Chat

> **Mục đích file này:** Cung cấp đủ thông tin để AI viết báo cáo đồ án tốt nghiệp mà không cần đọc toàn bộ source code.
> Tác giả: Đặng Giáp — ĐHBK Hà Nội, Khoa CNTT, tháng 4/2026.

---

## PHẦN 1: TỔNG QUAN HỆ THỐNG

### 1.1 Đề tài và mục tiêu

**Tên đề tài:** Xây dựng hệ thống web chat nội bộ doanh nghiệp có mã hóa đầu cuối (End-to-End Encrypted Chat)

**Bài toán:** Các doanh nghiệp vừa và nhỏ cần hệ thống nhắn tin nội bộ, nhưng không muốn tin nhắn của nhân viên bị lộ ngay cả khi server bị tấn công. Hệ thống cần đảm bảo: kể cả quản trị viên (IT admin) cũng không đọc được nội dung tin nhắn của người dùng.

**Mục tiêu cụ thể:**
- Xây dựng hệ thống web chat real-time có E2EE hoạt động trên trình duyệt (không cần cài app)
- Triển khai đúng giao thức X3DH (Extended Triple Diffie-Hellman) của Signal Protocol
- Mã hóa tin nhắn bằng AES-256-GCM với khóa phiên được sinh ra từ X3DH
- Lưu private key an toàn trong trình duyệt (IndexedDB), mã hóa bằng mật khẩu người dùng qua PBKDF2
- Deploy hoàn chỉnh bằng Docker Compose, có thể chạy trên máy chủ nội bộ

**Quy mô mục tiêu:** ~200 nhân viên trong 1 doanh nghiệp vừa và nhỏ.

---

### 1.2 Mô hình Blind Server

Toàn bộ thiết kế xoay quanh nguyên tắc **Blind Server**: server chỉ là trung gian chuyển tiếp, không có khả năng đọc nội dung bất kỳ tin nhắn nào.

| Thành phần | Server LƯU | Server KHÔNG CÓ |
|---|---|---|
| Tin nhắn 1-1 | Ciphertext + IV + AAD | Plaintext |
| Tin nhắn nhóm | N bản ciphertext (1 bản/người) + IV + AAD | Plaintext |
| File / ảnh | Encrypted bytes (UUID filename) | Nội dung file, loại file |
| Khóa mã hóa | Public key (IK, SPK, OPK) | Private key, Session Key, fileKey |
| Xác thực | JWT (HS256), bcrypt hash (cost 12) | Mật khẩu gốc |
| Người dùng | username, email, role, isActive | Private key của bất kỳ user nào |
| Metadata | sender/receiver id, timestamp, thành viên nhóm | — |

**Kết quả thực tế:** Nếu kẻ tấn công dump toàn bộ database PostgreSQL, họ chỉ lấy được:
- Ciphertext (không giải mã được nếu không có private key)
- Public key (vô dụng để giải mã)
- Metadata: ai chat với ai, lúc nào, bao nhiêu tin (đây là giới hạn đã biết)

---

### 1.3 Tổng quan tính năng đã hoàn thành

**Hoàn thành (tính đến tháng 6/2026):**
- Đăng ký/đăng nhập với email whitelist (IT admin duyệt trước)
- Sinh khóa IK, SPK, 100 OPK tại client bằng libsodium-wrappers
- X3DH: 4 phép DH + verify chữ ký Ed25519 + derive Session Key bằng HKDF-SHA256
- AES-256-GCM: mã hóa/giải mã tin nhắn với AAD chống tamper
- Private key lưu IndexedDB, mã hóa bằng PBKDF2(600k vòng) + AES-GCM
- WebSocket real-time relay (in-memory Map, 1 server instance)
- Fingerprint 60 chữ số: bắt buộc verify trước khi chat 1-1
- Chat 1-1 E2EE đầy đủ
- Chat nhóm E2EE (mô hình "N tin 1-1 song song")
- Gửi file/ảnh E2EE (max 10MB), clipboard paste
- Export/Import private key file `.e2ee` để chuyển thiết bị
- Admin system: whitelist email, enable/disable user, phân quyền ADMIN
- Docker Compose deploy: 1 lệnh `docker-compose up`

**Không nằm trong scope:**
- Double Ratchet, PQXDH, MLS, Sesame Protocol (multi-device sync)
- Typing indicator, read receipt, QR code, voice/video call

---

## PHẦN 2: KIẾN TRÚC KỸ THUẬT

### 2.1 Tech Stack

| Thành phần | Công nghệ | Phiên bản | Lý do chọn |
|---|---|---|---|
| Frontend | React + TailwindCSS | React 18 | SPA cần quản lý state phức tạp (keys, sessions, WS); Tailwind tiết kiệm thời gian CSS |
| Backend | Node.js + Express + ws | Node 24, Express 4 | Ecosystem phong phú, single-threaded I/O tốt cho WebSocket relay |
| Database | PostgreSQL 16 + Prisma ORM | PG 16, Prisma 6 | ACID transaction cần thiết cho atomic register; Prisma tránh raw SQL lỗi |
| Cache | Redis 7 | — | JWT blocklist: revoke token khi logout/đổi mật khẩu, O(1) lookup |
| Crypto (client) | libsodium-wrappers | latest | X25519/Ed25519 — Web Crypto API không hỗ trợ đủ rộng; libsodium constant-time |
| Crypto (client) | Web Crypto API | native | AES-GCM, HKDF, PBKDF2, SHA-512 — native browser, không cần dependency |
| Key storage | IndexedDB (Dexie.js) | — | Persistent trong browser, hỗ trợ transaction, Dexie đơn giản hóa API |
| Deploy | Docker Compose + Nginx | — | Deploy 1 lệnh, môi trường tái tạo được; Nginx reverse proxy + SSL termination |
| Tunnel | Cloudflare Tunnel | — | Expose local server ra internet không cần public IP (demo/dev environment) |

### 2.2 Sơ đồ kiến trúc tổng thể

```
[Browser Alice]                    [Server (VPS / máy nội bộ)]          [Browser Bob]
  E2EE layer                            Blind Server                     E2EE layer
  (encrypt)  ──── HTTPS/WSS ──►  [Nginx] → [Node.js/Express]  ◄────  (decrypt)
                                              │          │
                                       [PostgreSQL 16]  [Redis 7]
                                         (ciphertext)   (JWT blocklist)
```

Server KHÔNG đọc được nội dung — chỉ lưu và chuyển tiếp ciphertext.

### 2.3 Cấu trúc thư mục

```
e2ee-chat/
├── backend/
│   ├── server.js              # Entry point Express + WebSocket server
│   ├── routes/
│   │   ├── auth.js            # POST /auth/register, /login, /logout
│   │   ├── keys.js            # GET/POST /keys — quản lý key bundle
│   │   ├── messages.js        # GET/POST /messages — lưu + relay tin nhắn
│   │   ├── conversations.js   # POST/GET/PATCH/DELETE /conversations
│   │   ├── groups.js          # POST/GET /groups + quản lý thành viên
│   │   ├── files.js           # POST/GET /files — upload/download encrypted bytes
│   │   ├── peers.js           # PATCH /peers/:id/verify — đánh dấu đã verify fingerprint
│   │   └── admin.js           # Admin endpoints (whitelist, user management)
│   ├── middleware/
│   │   └── auth.js            # JWT verify + Redis blocklist + isActive check
│   ├── ws/
│   │   └── handler.js         # WebSocket handler, in-memory Map relay
│   ├── prisma/
│   │   └── schema.prisma      # DB schema (9 models)
│   └── redis.js               # Redis client singleton
├── frontend/src/
│   ├── pages/
│   │   ├── Login.jsx          # Form đăng nhập, xử lý DEVICE_NOT_REGISTERED
│   │   ├── Register.jsx       # Form đăng ký, sinh key + upload, loading indicator
│   │   ├── Chat.jsx           # Orchestrator chính: WS + X3DH + send logic
│   │   └── Admin.jsx          # Quản lý user + whitelist (chỉ ADMIN)
│   ├── components/
│   │   ├── UnlockModal.jsx    # Overlay sau reload: nhập password để unwrap key vào RAM
│   │   ├── FingerprintModal.jsx # SHA-512×5200, 60 chữ số, verify trước khi chat
│   │   ├── ChatSidebar.jsx    # Danh sách conversation + nhóm, search debounce 400ms
│   │   ├── MessageList.jsx    # Auto-scroll, infinite scroll (cursor pagination)
│   │   ├── MessageInput.jsx   # Auto-resize, Enter gửi, đính kèm file, Ctrl+V paste ảnh
│   │   ├── GroupInfoPanel.jsx # Thành viên nhóm + shield icon verify fingerprint
│   │   └── CreateGroupModal.jsx # Tạo nhóm: tìm kiếm + chọn thành viên
│   ├── hooks/
│   │   ├── useWebSocket.js    # WS singleton, xử lý message/presence/group, sessionKeysRef
│   │   └── useMessages.js     # Load lịch sử, cursor pagination, decrypt song song
│   ├── crypto/
│   │   ├── keyGen.js          # Sinh IK/SPK/OPK + PBKDF2 + wrap/unwrap private key
│   │   ├── x3dh.js            # verifySignedPreKey + X3DH sender + X3DH receiver
│   │   ├── aesGcm.js          # encrypt/decrypt message + file
│   │   └── fingerprint.js     # SHA-512×5200 → 60 chữ số decimal
│   ├── db/
│   │   └── storage.js         # Dexie.js: IndexedDB — private keys, session keys, OPK pool
│   ├── services/
│   │   ├── api.js             # 22+ hàm REST API call
│   │   └── socket.js          # WebSocket singleton, reconnect 3s, ping 30s
│   └── contexts/
│       └── AuthContext.jsx    # token/userId/role (localStorage) + wrappingKey/keys (RAM)
├── nginx/
│   └── nginx.conf             # Reverse proxy, WebSocket upgrade, SSL
└── docker-compose.yml         # 5 service: frontend, backend, postgres, redis, nginx
```

### 2.4 Nguyên tắc phân tầng frontend

```
pages/components  →  hooks  →  services / crypto / db
```
- `crypto/` không import gì từ React, hooks, hay services (pure functions, testable độc lập)
- `db/` không import gì từ crypto hay React
- `services/` không import gì từ React (pure API calls)

---

## PHẦN 3: LUỒNG MẬT MÃ CHI TIẾT

### 3.1 Các thuật toán crypto và lý do chọn

| Thuật toán | Mục đích | Tiêu chuẩn | Lý do chọn |
|---|---|---|---|
| X3DH | Thiết lập Session Key bất đồng bộ | Signal Whitepaper 2016 | Alice gửi tin khi Bob đang offline |
| X25519 (ECDH) | 4 phép DH trong X3DH | RFC 7748 | Constant-time tự nhiên, nhanh hơn P-256 2-4×, chuẩn de-facto của Signal/WhatsApp |
| Ed25519 (EdDSA) | Ký + verify SPK; keypair Identity Key vĩnh viễn | RFC 8032 | IK phải ký SPK; convert sang X25519 khi cần DH — đúng Signal spec |
| AES-256-GCM | Mã hóa tin nhắn + file (AEAD) | FIPS 197 + NIST SP 800-38D | Vừa encrypt vừa authenticate, hardware-accelerated, 128-bit auth tag |
| HKDF-SHA256 | Derive Session Key từ X3DH output | RFC 5869 | Làm sạch entropy ECDH output, spec của Signal |
| PBKDF2-SHA256 | Wrap private key bằng mật khẩu | RFC 8018, OWASP 2023 | Web Crypto API native, 600k iterations = ~0.5s, chống brute force offline |
| bcrypt (cost 12) | Hash password phía server | — | 2^12 = 4096 vòng, ~300ms/hash, cân bằng bảo mật và UX |
| SHA-512 (5200 vòng) | Tạo Fingerprint 60 chữ số | FIPS 180-4 | Theo Signal Safety Numbers specification |

**Tại sao X25519 không dùng P-256?**
X25519 có thiết kế constant-time tự nhiên (chống side-channel attack), nhanh hơn P-256 khoảng 2-4 lần, là chuẩn của toàn bộ secure messaging ecosystem (Signal, WhatsApp, ProtonMail). NIST P-256 có lịch sử tranh cãi về backdoor trong tham số Dual_EC_DRBG.

**Tại sao IK là Ed25519 không phải X25519?**
IK phải ký SPK bằng chữ ký số Ed25519 để chứng minh SPK là thật — X25519 không có khả năng ký. Khi IK tham gia DH trong X3DH, chuyển đổi sang X25519 bằng `crypto_sign_ed25519_sk_to_curve25519()` của libsodium. Đây đúng với Signal Protocol specification.

---

### 3.2 Luồng 1: Đăng ký tài khoản

```
Browser (Alice):
  1. Sinh Identity Key (IK) = crypto_sign_keypair() → Ed25519, vĩnh viễn
     IK_pub    = 32 bytes (Ed25519 public key)
     IK_secret = 64 bytes (libsodium: seed 32B + pub 32B ghép)

  2. Sinh Signed PreKey (SPK) = crypto_box_keypair() → X25519, 32 bytes
     SPK_sig = Ed25519.sign(IK_secret, SPK_pub)  ← ký để chứng minh SPK là của Alice

  3. Sinh 100 One-Time PreKey (OPK) = crypto_box_keypair() × 100 → X25519, mỗi cái dùng 1 lần

  4. wrapSalt = crypto.getRandomValues(16 bytes)
     wrappingKey = PBKDF2-SHA256(password, wrapSalt, 600_000 iterations)  ← chạy 1 LẦN

  5. Wrap từng private key bằng wrappingKey:
     wrappedIK  = AES-GCM.encrypt(IK_secret, wrappingKey, ivIK)
     wrappedSPK = AES-GCM.encrypt(SPK_priv, wrappingKey, ivSPK)
     wrappedOPKs[i] = AES-GCM.encrypt(OPK_priv[i], wrappingKey, ivOPK[i])

  6. Lưu IndexedDB: { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }

  7. POST /auth/register {
       username, password (bcrypt server-side),
       email (phải có trong AllowedEmail),
       IK_pub, SPK_pub, SPK_sig, OPK_pubs[100]  ← chỉ public key, KHÔNG có private key
     }

Server:
  → Check email trong AllowedEmail → 403 nếu không có
  → bcrypt.hash(password, cost=12)
  → prisma.$transaction: User.create + KeyBundle.create + AllowedEmail.update(usedAt)
  → Trả { userId, token, username, role }
```

**Lý do PBKDF2 chỉ chạy 1 lần:** 600k iterations ≈ 0.5s. Nếu chạy lại cho mỗi lần wrap private key thì 102 lần × 0.5s = 51 giây — không thể dùng được. Giải pháp: derive wrappingKey 1 lần → dùng CryptoKey đó cho tất cả AES-GCM wrap (mỗi lần AES-GCM chỉ tốn vài ms).

---

### 3.3 Luồng 2: Đăng nhập

```
Browser:
  1. POST /auth/login { username, password }
  2. Server: check isActive → bcrypt.compare → trả { token, userId, username, role }
  3. Lưu { token, userId, username, role } vào localStorage

  4. Kiểm tra thiết bị:
     hasKeys = IndexedDB.privateKeys.get(userId) !== null
     - false → POST /auth/logout (revoke token) → throw DEVICE_NOT_REGISTERED
     - true  → tiếp tục

  5. wrapSalt = IndexedDB.getWrapSalt(userId)
     wrappingKey = PBKDF2(password, wrapSalt, 600_000)  ← derive lại

  6. Unwrap private keys:
     IK_secret = AES-GCM.decrypt(wrappedIK, wrappingKey, ivIK)
     SPK_priv  = AES-GCM.decrypt(wrappedSPK, wrappingKey, ivSPK)
     IK_pub    = IK_secret.slice(32)  ← không cần lưu riêng

  7. { wrappingKey, IK_secret, IK_pub, SPK_priv } → lưu vào RAM (AuthContext state)
```

**Tại sao token lưu localStorage (không phải cookie HTTPOnly)?**
Sau reload, React state mất → wrappingKey mất → cần nhập lại password (UnlockModal). Token trong localStorage giúp app biết user đã đăng nhập → hiện UnlockModal thay vì redirect login. Rủi ro XSS giảm thiểu bằng CSP; private key vẫn an toàn vì wrappingKey chỉ sống trong RAM.

**UnlockModal (sau reload):**
App khởi động → `isAuthenticated=true` (có token localStorage) nhưng `isLocked=true` (wrappingKey=null) → hiện overlay yêu cầu nhập lại password → unwrap key vào RAM → `isLocked=false` → vào chat.

---

### 3.4 Luồng 3: X3DH — Thiết lập phiên chat 1-1 lần đầu

**Bối cảnh:** Alice muốn chat với Bob lần đầu. Bob có thể đang offline.

```
Bước 1: Alice lấy key bundle của Bob
  GET /keys/bob → nhận { IK_pub_B, SPK_pub_B, SPK_sig, OPK_pub_B, OPK_id }
  (Server xóa OPK_B này khỏi pool — dùng 1 lần)

Bước 2: Verify chữ ký SPK (BẮT BUỘC)
  Ed25519.verify(IK_pub_B, SPK_sig, SPK_pub_B)
  → false → DỪNG (server có thể đã giả mạo SPK → MITM attack)
  → true  → tiếp tục

Bước 3: Sinh Ephemeral Key (chỉ dùng 1 lần cho session này)
  EK = crypto_box_keypair()  → X25519

Bước 4: Tính 4 phép Diffie-Hellman
  [Convert IK_secret → X25519 bằng crypto_sign_ed25519_sk_to_curve25519]
  DH1 = X25519(IK_x25519_A,  SPK_pub_B)   ← mutual authentication
  DH2 = X25519(EK_priv_A,    IK_pub_B_x)  ← mutual authentication (IK_pub_B convert sang X25519)
  DH3 = X25519(EK_priv_A,    SPK_pub_B)   ← forward secrecy (EK ephemeral)
  DH4 = X25519(EK_priv_A,    OPK_pub_B)   ← forward secrecy (OPK dùng 1 lần)

Bước 5: Derive Session Key bằng HKDF-SHA256
  F   = 0xFF × 32 bytes  (phân biệt X25519 với X448, theo Signal spec)
  IKM = F || DH1 || DH2 || DH3 || DH4  → 5 × 32 = 160 bytes
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1", length=32)

Bước 6: Lưu SK, xóa vật liệu tạm (Forward Secrecy)
  wrappedSK = AES-GCM.encrypt(SK_raw, wrappingKey)
  IndexedDB.sessions.put({ conversationId, wrappedSK, ivSK })
  EK_priv_A, DH1, DH2, DH3, DH4 → null  ← XÓA NGAY

Bước 7: Gửi tin đầu tiên
  POST /messages {
    conversationId,
    IK_pub_A, EK_pub_A, OPK_id,  ← Bob cần để tính lại SK
    ciphertext, iv, aad           ← tin nhắn đã mã hóa bằng SK
  }

Bob nhận tin, tính lại SK chiều ngược:
  OPK_priv_B = IndexedDB.getOPK(userId, opkId, wrappingKey)  ← chỉ unwrap 1 OPK
  DH1 = X25519(SPK_priv_B,  IK_pub_A_x)
  DH2 = X25519(IK_x25519_B, EK_pub_A)
  DH3 = X25519(SPK_priv_B,  EK_pub_A)
  DH4 = X25519(OPK_priv_B,  EK_pub_A)
  SK  = HKDF-SHA256(F||DH1||DH2||DH3||DH4, ...) → ra cùng SK với Alice
  IndexedDB.deleteOPK(opkId)  ← xóa OPK đã dùng, không thể replay
  Giải mã tin nhắn
```

**Từ tin nhắn thứ 2 trở đi:** Chỉ cần lấy SK từ cache (RAM hoặc IndexedDB), không cần X3DH lại.

---

### 3.5 Luồng 4: Gửi tin nhắn 1-1 (AES-256-GCM)

```
Alice muốn gửi "Xin chào Bob":

  SK = getOrCreateSK(conversationId):
    1. sessionKeysRef.current.get(conversationId)  ← RAM cache (nhanh nhất)
    2. IndexedDB.sessions.get(conversationId)      ← persistent cache
    3. X3DH sender                                 ← nếu chưa có SK

  IV  = crypto.getRandomValues(12 bytes)  ← random mỗi tin, không bao giờ tái sử dụng
  AAD = `${conversationId}:${senderId}`   ← không mã hóa nhưng được xác thực

  { ciphertext } = AES-256-GCM.encrypt(plaintext, SK, IV, AAD)

  → Optimistic UI: hiển thị tin ngay lập tức (trạng thái "đang gửi")
  POST /messages { conversationId, ciphertext, iv, aad }
  → Server lưu DB trước → relay qua WebSocket → Bob nhận → giải mã
```

**Tại sao cần AAD?**
Không có AAD: attacker có thể thay senderId hoặc chuyển ciphertext sang conversation khác mà AES-GCM không phát hiện.
Với AAD `${conversationId}:${senderId}`: bất kỳ thay đổi nào → auth_tag sai → decrypt fail → hiển thị "[Lỗi giải mã]".

---

### 3.6 Luồng 5: Fingerprint Verification (chống MITM)

```
Alice và Bob tính fingerprint độc lập:

  sorted_keys = sort([IK_pub_Alice, IK_pub_Bob])  ← sort byte-by-byte canonical
  hash = SHA-512(concat(sorted_keys))             ← vòng 1
  for i in 1..5199: hash = SHA-512(hash)          ← tổng 5200 vòng
  fingerprint = BigInt(hash) % 10^60              ← 60 chữ số decimal, padStart(60, '0')

Alice đọc 60 chữ số cho Bob nghe qua kênh ngoài (điện thoại, gặp trực tiếp).
Khớp → PATCH /conversations/:convId/fingerprint + PATCH /peers/:peerId/verify
      → UI mở khóa MessageInput → được phép nhắn tin
Không khớp → có thể đang bị MITM → dừng lại
```

**Tại sao bắt verify TRƯỚC khi chat 1-1?**
Đảm bảo người dùng ý thức được rủi ro MITM. Nếu server thay IK_pub giả → fingerprint sai → phát hiện ngay. Nhóm không bắt buộc (giống Signal) để không cản trở UX, nhưng vẫn hỗ trợ verify tự nguyện.

**PeerVerification là global:** Verify Bob 1 lần (qua 1-1 hoặc nhóm) → bản ghi `PeerVerification(verifierId=Alice, peerId=Bob)` → shield icon xanh ở MỌI nhóm có Bob, không phải per-conversation.

---

### 3.7 Luồng 6: Group Chat E2EE ("N tin 1-1 song song")

**Mô hình:** Mỗi tin nhắn group = N bản ciphertext riêng (1 cho mỗi thành viên), mã hóa bằng SK 1-1 riêng.

```
Alice gửi "Hello team" vào nhóm {Alice, Bob, Charlie}:

  SK_alice_bob     = getOrCreateGroupSK(groupId, bobId)      ← cache key: "${groupId}:${bobId}"
  SK_alice_charlie = getOrCreateGroupSK(groupId, charlieId)

  ciphertext1 = AES-GCM.encrypt(plaintext, SK_alice_bob,     AAD=`${groupId}:${aliceId}`)
  ciphertext2 = AES-GCM.encrypt(plaintext, SK_alice_charlie, AAD=`${groupId}:${aliceId}`)

  POST /messages {
    groupId,
    messages: [
      { recipientId: bobId,     ciphertext: ciphertext1, iv, aad },
      { recipientId: charlieId, ciphertext: ciphertext2, iv, aad }
    ]
  }

Server:
  → Kiểm tra sender là member của group
  → INSERT N bản ghi vào Message (groupId + recipientId riêng cho mỗi bản)
  → Relay real-time cho từng member đang online

Bob nhận tin:
  SK_bob_alice = getOrCreateGroupSK(groupId, aliceId)  ← X3DH hoặc cache
  decryptMessage(ciphertext, SK_bob_alice, ...)
```

**Ưu điểm:** Tái sử dụng hoàn toàn cơ chế X3DH + AES-GCM đã xây dựng, không cần thêm protocol phức tạp.

**Nhược điểm:** N người → N bản ciphertext → không scale tốt với group lớn (> 20 người). Phù hợp với doanh nghiệp vừa và nhỏ (scope đồ án).

---

### 3.8 Luồng 7: Gửi File/Ảnh E2EE

**Chat 1-1:** Dùng SK của conversation

```
Alice gửi file cho Bob:
  { encryptedBytes, fileIv } = encryptBytes(fileBytes, SK)
  POST /files/upload (FormData) → { fileId }
  payload = JSON.stringify({ type: "image", fileId, fileName, mimeType, fileSize, fileIv })
  → encryptMessage(payload, SK, ...) → gửi như tin nhắn thường

Bob nhận:
  plaintext = decryptMessage(...)  → JSON.parse → type="image"
  encryptedBytes = GET /files/:fileId
  fileBytes = decryptBytes(encryptedBytes, fileIv, SK)
```

**Chat nhóm:** Dùng Random FileKey (không dùng SK)

```
Alice gửi file vào nhóm:
  { encryptedBytes, fileKey, fileIv } = encryptBytesWithRandomKey(fileBytes)
  POST /files/upload → { fileId }  ← upload 1 lần duy nhất

  Với mỗi thành viên:
    payload = { type: "image", fileId, fileName, mimeType, fileSize, fileIv, fileKey }
    → encryptMessage(payload, SK_alice_bob, ...)  ← fileKey được bảo vệ bởi SK 1-1
```

**Tại sao group dùng random fileKey?** Dùng SK: phải encrypt file N lần → upload N bản → băng thông O(N). Random fileKey: encrypt 1 lần → upload 1 bản → fileKey đi theo message payload của từng người → băng thông O(1) cho file. Server vẫn chỉ thấy 1 encrypted blob.

---

### 3.9 Luồng 8: Chuyển thiết bị (Export/Import key)

```
EXPORT (thiết bị cũ):
  data = IndexedDB.privateKeys.get(userId)
  → { userId, wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
  → TẤT CẢ đã wrap bằng wrappingKey — plaintext private key KHÔNG xuất hiện
  → download file e2ee-keys-{userId}.e2ee

IMPORT (thiết bị mới):
  Login → DEVICE_NOT_REGISTERED → upload file .e2ee
  → IndexedDB.privateKeys.put(data) → Login lại bình thường
```

**Bảo mật:** Có file mà không có password → không giải mã được. Có cả 2 → tương đương bị lộ credential.

---

## PHẦN 4: MÔ HÌNH BẢO MẬT

### 4.1 Phân tích các tấn công và cơ chế phòng thủ

| Tấn công | Cơ chế phòng thủ | Hiệu quả |
|---|---|---|
| Passive eavesdropping (nghe lén đường truyền) | AES-256-GCM + HTTPS/WSS | Hoàn toàn |
| Server bị hack, dump database | Blind Server: chỉ có ciphertext | Hoàn toàn (về nội dung) |
| Replay attack 1-1 | OPK dùng 1 lần + `@@unique([conversationId, iv])` trong DB | Hoàn toàn |
| Replay attack group | `@@unique([groupId, recipientId, iv])` | Hoàn toàn |
| MITM (thay public key) | Ed25519 ký SPK + Fingerprint verify bắt buộc (1-1) | Hoàn toàn nếu user verify |
| Tamper ciphertext hoặc AAD | AES-GCM auth tag 128-bit; AAD = `${convId}:${senderId}` | Hoàn toàn |
| Brute force password (offline) | PBKDF2 600k iterations (client) + bcrypt cost 12 (server) | Tốt |
| Truy cập trái phép | Email whitelist (AllowedEmail) + JWT | Tốt |
| Privilege escalation | Role field trong JWT + adminMiddleware check server-side | Tốt |
| Race condition admin revoke | PostgreSQL `FOR UPDATE` row lock trong transaction | Hoàn toàn |
| JWT bị đánh cắp (logout) | Redis blocklist — token bị revoke ngay khi logout | Hoàn toàn |
| XSS đọc private key | Private key chỉ trong RAM (không serialize ra DOM); CSP | Trung bình |
| Timing attack (login) | DUMMY_HASH — bcrypt.compare chạy dù user không tồn tại | Hoàn toàn |

### 4.2 Mô hình tin cậy (Trust Model)

- **Người dùng trust nhau:** Phải verify fingerprint trực tiếp qua kênh ngoài (điện thoại/gặp mặt)
- **Không trust server:** Server không có private key, không đọc được tin nhắn
- **Không trust kết nối:** HTTPS/WSS mã hóa vận chuyển; AES-GCM mã hóa nội dung (2 lớp)
- **Trust mật khẩu:** Private key được bảo vệ bởi PBKDF2 — mật khẩu mạnh là yêu cầu tối thiểu

### 4.3 JWT và phiên làm việc

```
JWT payload: { userId, username, role, iat, exp }
JWT expiry: 7 ngày
JWT secret: 256-bit random (ENV)

Khi logout / đổi mật khẩu:
  Redis.set(`blocklist:${token}`, 1, EX 604800)  ← TTL = thời gian còn lại của token

authMiddleware kiểm tra mỗi request:
  1. jwt.verify(token, JWT_SECRET)
  2. redis.get(`blocklist:${token}`)  → 401 nếu có
  3. user.isActive === true           → 401 nếu bị disable
```

### 4.4 Admin System (Role-Based Access Control)

- Admin là user thực trong hệ thống — không có "super admin secret" riêng
- Admin cũng bị E2EE bảo vệ — admin không đọc được tin nhắn của người khác
- Admin seed qua `ADMIN_SEED_EMAIL` trong docker-compose.yml (bypass whitelist 1 lần)
- Race condition "2 admin revoke nhau đồng thời" → giải bằng `SELECT COUNT(*) FOR UPDATE` trong PostgreSQL transaction

---

## PHẦN 5: THIẾT KẾ DATABASE

### 5.1 Schema (9 models)

```
User               — thông tin tài khoản, role, isActive
AllowedEmail       — whitelist email được phép đăng ký
KeyBundle          — public key bundle của mỗi user (IK, SPK, OPK pool)
Conversation       — cuộc trò chuyện 1-1 (participantA, participantB)
Group              — nhóm chat
GroupMember        — thành viên nhóm (role ADMIN/MEMBER)
Message            — tin nhắn (1-1 hoặc group, mỗi bản = 1 người nhận với group)
UploadedFile       — metadata file đã upload (content lưu trên disk)
PeerVerification   — ai đã verify fingerprint của ai (global, không per-conversation)
```

**Bảng đặc trưng nhất là KeyBundle:** Không có trong hệ thống chat thông thường. Lưu public key để X3DH bất đồng bộ — Alice chat được với Bob khi Bob đang offline.

### 5.2 Thiết kế Message cho group

```prisma
model Message {
  conversationId String?   -- null nếu là tin nhắn group
  groupId        String?   -- null nếu là tin nhắn 1-1
  recipientId    String?   -- null với 1-1, non-null với group (1 bản ghi = 1 người nhận)
  senderId       String
  ciphertext     String    -- base64
  iv             String    -- 12 bytes, random mỗi tin
  aad            String    -- "conversationId:senderId" hoặc "groupId:senderId"
  ekPub          String?   -- X3DH init: EK_pub
  opkId          String?   -- X3DH init: OPK_id đã dùng
  ikPub          String?   -- X3DH init: IK_pub của sender

  @@unique([conversationId, iv])              -- chống replay attack 1-1
  @@unique([groupId, recipientId, iv])        -- chống replay attack group
  @@index([conversationId, createdAt(sort: Desc)])   -- pagination 1-1
  @@index([groupId, recipientId, createdAt(sort: Desc)]) -- pagination group
}
```

### 5.3 Cursor Pagination

Load lịch sử sử dụng cursor pagination (không phải offset) vì:
- Offset pagination: `SKIP 10000` phải duyệt 10k bản ghi → chậm với lịch sử dài
- Cursor pagination: `WHERE createdAt < cursor ORDER BY createdAt DESC LIMIT 20` → luôn O(log n) với index

```
GET /messages/:convId?cursor=<message_id>&limit=20
→ findMany({ where: { ..., id: { lt: cursor } }, orderBy: { createdAt: 'desc' }, take: 21 })
→ hasMore = (results.length === 21), trả 20 bản ghi thực
```

### 5.4 Index quan trọng

| Index | Lý do |
|---|---|
| `User.username @unique` | Tìm user khi login, O(1) |
| `User.email @unique` | Check whitelist và đăng ký trùng |
| `Conversation.@@unique([participantA, participantB])` | Idempotent create conversation |
| `Conversation.@@index([participantA])` | Load danh sách conversation của user |
| `Message.@@index([conversationId, createdAt DESC])` | Cursor pagination lịch sử 1-1 |
| `Message.@@index([groupId, recipientId, createdAt DESC])` | Cursor pagination lịch sử group |
| `Message.@@unique([conversationId, iv])` | Constraint chống replay attack |
| `PeerVerification.@@unique([verifierId, peerId])` | Upsert idempotent, tránh duplicate |

---

## PHẦN 6: KẾT QUẢ TRIỂN KHAI VÀ THỰC NGHIỆM

### 6.1 Môi trường triển khai

- **Máy chủ:** Máy cá nhân (Windows 11) + Docker Desktop 4.70.0
- **Domain:** `chat.danggiap.id.vn` (Cloudflare Tunnel — expose local server ra internet)
- **Docker Compose services:** frontend (React build served by Nginx), backend (Node.js), postgres, redis, nginx
- **Deploy:** `docker-compose up -d` — toàn bộ hệ thống chạy trong 1 lệnh

### 6.2 Tính năng đã kiểm thử (tính đến 16/06/2026)

| Tính năng | Trạng thái |
|---|---|
| Đăng ký + sinh key (IK, SPK, 100 OPK) | ✅ Pass |
| Đăng nhập + unwrap key vào RAM | ✅ Pass |
| X3DH thiết lập session key | ✅ Pass (2 browser thực) |
| AES-256-GCM mã hóa/giải mã tin nhắn | ✅ Pass |
| WebSocket real-time relay | ✅ Pass |
| Fingerprint 60 chữ số + verify | ✅ Pass |
| Chat 1-1 E2EE end-to-end | ✅ Pass |
| Group chat E2EE | ✅ Pass |
| Gửi file/ảnh E2EE 1-1 và group | ✅ Pass |
| Clipboard paste ảnh (Ctrl+V) | ✅ Pass |
| Export/Import key file .e2ee | ✅ Pass |
| UnlockModal sau reload | ✅ Pass |
| Admin: whitelist, enable/disable user | ✅ Pass |
| Docker Compose deploy 1 lệnh | ✅ Pass |
| Cursor pagination lịch sử | ✅ Pass |

### 6.3 Hiệu năng đo được (thực tế)

| Metric | Giá trị |
|---|---|
| Sinh 100 OPK + wrap + upload lúc đăng ký | ~1-2 giây (Chrome, máy trung bình) |
| PBKDF2(600k iterations) khi login | ~0.5 giây |
| X3DH sender (4 phép DH + HKDF) | < 10ms |
| AES-256-GCM encrypt 1 tin nhắn | < 1ms |
| SHA-512 × 5200 vòng (fingerprint) | ~200-500ms |
| Độ trễ WebSocket relay (LAN) | < 5ms |
| Upload file 10MB (encrypted) | ~2-5 giây (tùy mạng) |

### 6.4 Số liệu thiết kế

- Tối đa 100 OPK per user; cảnh báo khi < 10 OPK còn lại
- Tin nhắn lưu với cursor pagination, mỗi trang 20 tin
- JWT expiry: 7 ngày; Redis blocklist TTL khớp với expiry
- Kích thước file tối đa: 10MB (multer limit)
- bcrypt cost 12: ~300ms/hash (server-side), đủ chậm để chống brute force

---

## PHẦN 7: HẠN CHẾ VÀ HƯỚNG PHÁT TRIỂN

### 7.1 Hạn chế đã biết (nêu thành thật trong báo cáo)

#### Về mật mã học

**Không có Double Ratchet (Session-level Forward Secrecy, không phải Message-level):**
- Hệ thống có Forward Secrecy ở cấp phiên: EK ephemeral và OPK bị xóa ngay sau X3DH
- Tuy nhiên từ tin nhắn thứ 2 trở đi, tất cả dùng cùng 1 SK → nếu SK bị lộ, toàn bộ tin trong phiên bị đọc
- Signal giải quyết bằng Double Ratchet (spec 40 trang) — nằm ngoài phạm vi 6 tuần
- *Câu trả lời cho GV:* Trade-off có chủ ý giữa complexity và security level. Hướng phát triển tương lai.

**SPK không xoay vòng định kỳ:**
- API `POST /keys/spk` đã sẵn sàng phía server
- Hàm `rotateSpk()` đã có phía frontend nhưng chưa được kích hoạt tự động
- Signal khuyến nghị xoay SPK mỗi 7 ngày

**Hết OPK không tự bổ sung end-to-end:**
- Server trả 410 khi OPK pool cạn kiệt
- Cơ chế WS event `low_opk` chưa được nối đầu cuối (server emit, client lắng nghe và upload thêm)

#### Về hệ thống

**JWT trong WebSocket URL:**
- WebSocket API của browser không hỗ trợ custom header khi kết nối → token phải đặt vào query string
- Token xuất hiện trong nginx access log → IT admin/DevOps có thể đọc
- Tác động thực tế: có JWT mà không có mật khẩu → không giải mã được tin nhắn (không có private key)
- Giải pháp tương lai: auth qua WS message đầu tiên sau handshake

**Vô hiệu hóa tài khoản không ngắt session ngay:**
- User đang kết nối vẫn hoạt động bình thường đến khi tự reload (JWT chưa bị revoke vào Redis)
- Giải pháp tương lai: revoke JWT vào Redis + đóng WebSocket connection ngay khi admin disable

**Không có rate limiting:**
- bcrypt cost 12 (~300ms) làm chậm brute force tự nhiên
- Chưa có hard limit theo IP (đã bỏ vì Cloudflare Tunnel phức tạp hóa IP detection)

#### Về khả năng mở rộng

**WebSocket in-memory relay không scale ngang:**
- `clients = Map<userId, WebSocket>` sống trong RAM của 1 Node.js process
- Chạy 2 instance → không relay cross-instance
- Giải pháp tương lai: Redis Pub/Sub

**File lưu trên local disk:**
- Docker volume không có replication hay backup tự động
- Giải pháp tương lai: MinIO / S3-compatible object storage

**Single-device:**
- Private key chỉ tồn tại trong IndexedDB của trình duyệt đăng ký
- Export/Import thủ công qua file `.e2ee` là giải pháp tạm thời
- Giải pháp đầy đủ: Signal Sesame Protocol (multi-device sync) — ngoài phạm vi

#### Hạn chế cố hữu của E2EE

**Metadata lộ:** Server biết ai chat với ai, lúc nào, bao nhiêu tin. Signal giải quyết bằng Sealed Sender — ngoài phạm vi.

**Không có tìm kiếm tin nhắn:** Server chỉ có ciphertext, không thể search. Client cũng chưa có search local.

**Endpoint security:** Nếu máy người dùng nhiễm malware → kẻ tấn công lấy được mật khẩu → giải mã private key. E2EE không bảo vệ được thiết bị đầu cuối bị compromise — đây là giới hạn cố hữu của mọi hệ thống E2EE.

**Chưa Post-Quantum:** X25519/Ed25519 sẽ bị máy tính lượng tử phá bằng thuật toán Shor. Signal đã chuyển sang PQXDH (Kyber-1024 + X25519) từ 2023.

---

### 7.2 Hướng phát triển tương lai

| # | Tính năng | Độ ưu tiên | Độ phức tạp |
|---|---|---|---|
| 1 | Double Ratchet | Cao | Rất cao (spec 40 trang) |
| 2 | PQXDH (X25519 + Kyber-1024/ML-KEM) | Cao | Cao |
| 3 | MLS (RFC 9420) — group chat scale lớn | Trung bình | Rất cao |
| 4 | Multi-device sync (Sesame Protocol) | Cao | Rất cao |
| 5 | Sealed Sender — ẩn metadata người gửi | Trung bình | Cao |
| 6 | Redis Pub/Sub — WebSocket scale ngang | Cao | Trung bình |
| 7 | Argon2id thay PBKDF2 (khi WASM browser support tốt hơn) | Trung bình | Thấp |
| 8 | SPK rotation tự động (mỗi 7 ngày) | Cao | Thấp |
| 9 | OPK auto-replenishment (WS event → upload thêm) | Cao | Thấp |
| 10 | 2FA (TOTP/email OTP) | Trung bình | Trung bình |
| 11 | Audit log cho hành động admin | Thấp | Thấp |
| 12 | Client-side message search (flexsearch + IndexedDB) | Thấp | Trung bình |
| 13 | Backup key reminder bắt buộc sau đăng ký | Trung bình | Thấp |

---

## PHỤ LỤC: Q&A cho phiên phản biện

### Câu hỏi về mật mã

**"Server phân phối public key — nếu server bị hack thì MITM được không?"**
> CÓ thể MITM, nhưng hệ thống có 3 lớp phát hiện: (1) SPK được Bob ký bằng Ed25519 — hacker thay key → chữ ký sai → X3DH dừng ngay; (2) Nếu hacker thay cả IK lẫn SPK → DH ra SK khác → tin nhắn không giải mã được; (3) Fingerprint SHA-512×5200 — Alice và Bob so sánh 60 chữ số qua kênh ngoài → IK giả → số khác. Trong nội bộ doanh nghiệp, user biết nhau → verify dễ.

**"Perfect Forward Secrecy của hệ thống này ở mức nào?"**
> Session-level PFS: EK ephemeral bị xóa ngay sau X3DH, OPK dùng 1 lần và xóa khỏi IndexedDB — không ai tính lại được SK cho session đó. Giới hạn: từ tin nhắn thứ 2 trở đi, 2 bên dùng chung 1 SK — nếu SK lộ thì toàn bộ tin trong session bị đọc. Signal giải bằng Double Ratchet (per-message key rotation) — nằm ngoài scope đồ án.

**"Tại sao dùng X25519 không dùng P-256?"**
> X25519 constant-time tự nhiên (chống side-channel), nhanh hơn P-256 khoảng 2-4 lần, là chuẩn của Signal/WhatsApp/ProtonMail. NIST P-256 có lịch sử tranh cãi về backdoor.

**"Tại sao IK là Ed25519 không phải X25519?"**
> IK phải ký SPK bằng Ed25519 — X25519 không có khả năng ký. Khi IK tham gia DH, chuyển đổi sang X25519 bằng `crypto_sign_ed25519_sk_to_curve25519()`. Đây đúng với Signal spec.

**"Tại sao chỉ 1 wrapSalt cho tất cả private key?"**
> wrapSalt derive wrappingKey duy nhất qua PBKDF2. wrappingKey này AES-GCM encrypt từng key với IV riêng (random). Salt chống rainbow table, IV chống ciphertext giống nhau. Không cần nhiều salt vì PBKDF2 chỉ chạy 1 lần — thêm salt per-key buộc PBKDF2 chạy 102 lần = 51 giây.

**"Tại sao group file dùng random fileKey thay vì SK?"**
> SK: encrypt file N lần → upload N bản → băng thông O(N). Random fileKey: encrypt 1 lần → upload 1 bản → fileKey nhúng vào message payload bảo vệ bởi SK 1-1 riêng → băng thông O(1). Server vẫn chỉ thấy 1 blob encrypted.

**"Admin có đọc được tin nhắn không?"**
> Không. Admin là user thực — không có private key của người khác. Admin chỉ quản lý whitelist và trạng thái tài khoản. E2EE bảo vệ nội dung kể cả với admin.

### Câu hỏi về kỹ thuật

**"Race condition 2 admin thu hồi quyền nhau là gì? Giải quyết thế nào?"**
> Không có lock: cả 2 thấy count=2 → cả 2 revoke → không còn admin. Giải pháp: `prisma.$transaction` với `SELECT COUNT(*) WHERE role=ADMIN FOR UPDATE` → PostgreSQL lock row → request thứ 2 chờ, đọc lại count=1 → bị từ chối.

**"Tại sao lưu DB trước rồi mới relay WebSocket?"**
> Relay trước rồi sập: Alice nhận tin nhưng reload mất. Lưu DB trước: tin an toàn, chỉ cần reload là thấy. Chênh lệch 5-15ms, người dùng không cảm nhận.

**"Token JWT trong WebSocket URL có an toàn không?"**
> WebSocket API của browser không hỗ trợ custom header khi kết nối — đây là constraint kỹ thuật. Token trong query string xuất hiện trong nginx log → IT admin có thể đọc. Tuy nhiên: có JWT mà không có mật khẩu → không giải mã được tin nhắn (không có private key trong IndexedDB của người dùng). Giải pháp tương lai: auth qua WS message đầu tiên.

**"PeerVerification hoạt động thế nào? Tại sao global không phải per-conversation?"**
> Fingerprint = hàm của (IK_pub_A, IK_pub_B) — không đổi dù context là 1-1 hay nhóm. Verify Bob 1 lần → bản ghi PeerVerification(Alice, Bob) trong DB → shield icon xanh ở MỌI nơi có Bob. Không cần verify lại ở mỗi nhóm — giống cách Signal xử lý Safety Numbers.

**"Hệ thống có bao nhiêu bảng? Lý do thiết kế vậy?"**
> 9 bảng: User, AllowedEmail, KeyBundle, Conversation, Group, GroupMember, Message, UploadedFile, PeerVerification. Bảng đặc trưng nhất là KeyBundle (lưu public key cho X3DH bất đồng bộ) và AllowedEmail (kiểm soát đăng ký — không có trong hệ thống chat thông thường).

---

*File này được sinh tự động từ toàn bộ source code, docs kỹ thuật, và docs chuẩn bị phản biện của dự án.*
*Cập nhật lần cuối: 19/06/2026*
