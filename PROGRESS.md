# Tiến độ dự án E2EE Chat

## Cập nhật lần cuối: 08/06/2026 (session 25)

## Tổng quan 6 tuần
| Tuần | Mục tiêu | Trạng thái |
|------|----------|------------|
| 1 | Setup môi trường + Crypto layer | ✅ Xong |
| 2 | Backend: DB, REST API, WebSocket, Redis | ✅ Xong |
| 3 | Frontend + 1-1 chat end-to-end | ✅ Xong |
| 4 | Polish + Fingerprint UI + Docker | ✅ Xong |
| 5 | Bonus: Group chat + gửi file/ảnh E2EE + clipboard paste | ✅ Xong |
| 6 | Hardening + báo cáo + slide + demo | ⏳ Chưa |

---

## Chi tiết tiến độ

### ✅ Đã hoàn thành

**Ngày 1 (21/04)**
- Node.js v24.14.0 có sẵn
- Docker Desktop v4.70.0 cài thành công
- Repo GitHub tạo xong (private)
- Folder structure: backend/, frontend/, nginx/
- docker-compose.yml chạy được PostgreSQL 16 + Redis 7
- .gitignore setup xong
- Push lên GitHub

**Ngày 2 (22/04)**
- Crypto layer test pass trên console:
  - Sinh key pair IK, SPK, OPK bằng libsodium
  - X3DH 4 phép DH chạy đúng
  - AES-256-GCM encrypt/decrypt OK
  - HKDF derive session key OK
- Deep Research ngày 1: Signal Protocol / X3DH

**Ngày 3 (23/04)**
- Express server chạy được trên port 3000
- Route /health hoạt động
- nodemon setup (tự restart khi sửa code)
- Prisma init + schema 4 bảng: User, KeyBundle, Conversation, Message
- Migration init chạy thành công
- Thêm bảng Conversation + index cho quy mô 73M tin nhắn/năm
- Migration add_conversation chạy thành công
- Cập nhật ARCHITECTURE.md khớp với schema thực tế

---

**Ngày 4-5 (24/04 - 03/05)**
- ✅ backend/.env — JWT_SECRET 256-bit + REDIS_URL
- ✅ backend/redis.js — kết nối Redis dùng chung
- ✅ backend/middleware/auth.js — verify JWT + Redis blocklist
- ✅ backend/routes/auth.js — register (argon2id) + login (timing attack protection) + logout (blocklist)
- ✅ backend/server.js — mount auth routes
- ✅ Test Postman: register / login / logout đều pass
- ✅ Hạ Prisma 7 → 6 (Prisma 7 yêu cầu adapter phức tạp hơn scope)

---

**Ngày 6 (03/05)**
- ✅ backend/routes/keys.js — 4 endpoint:
  - POST /keys/upload  : upload IK+SPK+OPK lần đầu (từ chối 409 nếu gọi lần 2)
  - GET  /keys/:userId : Bob fetch key Alice, pop 1 OPK, placeholder WS low_opk
  - POST /keys/opk     : thêm OPK khi sắp hết (giới hạn MAX=100, trả added/previous/current)
  - POST /keys/spk     : rotate SPK định kỳ (không đụng IK và OPK)
- ✅ backend/server.js — mount keyRoutes vào app.use('/keys')
- ✅ Test Postman: tất cả 8 test case pass (upload, fetch ×4, 410, opk, spk)
- ✅ Cài TablePlus để xem DB trực quan

---

**Ngày 7 (04/05)**
- ✅ backend/routes/conversations.js — 1 endpoint:
  - POST /conversations : tạo conversation giữa 2 user, idempotent (tìm cả 2 chiều A↔B, không tạo trùng)
- ✅ backend/routes/messages.js — 2 endpoint:
  - POST /messages      : lưu ciphertext vào DB, kiểm tra membership, hỗ trợ ekPub+opkId cho X3DH tin đầu
  - GET  /messages/:convId : load lịch sử, cursor pagination (orderBy createdAt desc, skip:1)
- ✅ backend/server.js — mount conversationRoutes + messageRoutes
- ✅ Chốt thiết kế AAD: `conversationId:senderId` (không có timestamp vì đồng hồ client/server lệch nhau)
- ✅ Test Postman: toàn bộ luồng 9 bước pass (register×2 → login×2 → upload key×2 → tạo conv → gửi tin → load lịch sử)
- ✅ Đổi Argon2id → BCrypt (cost 12) theo đề xuất của thầy — đơn giản hơn, dễ giải thích hơn
- ✅ Thêm cross-env UV_THREADPOOL_SIZE=8 vào package.json — tận dụng 8 core CPU
- ✅ Tạo docs/QA.md — ghi lại 13 khái niệm kỹ thuật đã thảo luận

---

---

**Ngày 8 (09/05)**
- ✅ Ôn tập hoàn chỉnh toàn bộ backend (câu 15-27): cursor pagination, IDOR, Singleton Redis, dotenv, express.json, prefix mount, Foreign Key
- ✅ backend/routes/users.js — GET /users?search= : tìm kiếm user (contains, insensitive, max 20, loại bỏ bản thân)
- ✅ backend/routes/conversations.js — thêm 2 endpoint:
  - GET /conversations: danh sách conv kèm peer info + lastMessageAt, sort mới nhất trước
  - PATCH /conversations/:convId/fingerprint: đánh dấu verified (idempotent, không cho unverify)
- ✅ backend/server.js — mount userRoutes
- ✅ Thảo luận kiến trúc: Redis-first vs DB-first, online status, fingerprint 1 phía vs 2 phía, read receipt
- ✅ Quyết định: thêm Online Status vào WebSocket (không vi phạm Blind Server)
- ✅ Test tự động toàn bộ endpoint mới — pass hết
- ✅ Cập nhật QA (câu 28-35), ARCHITECTURE.md, PROGRESS.md

---

**Ngày 9–10 (10/05–11/05)**
- ✅ Chốt kiến trúc: bỏ Redis Pub/Sub cho WebSocket, dùng in-memory Map đơn giản hơn
- ✅ backend/ws/handler.js — WebSocket server hoàn chỉnh:
  - Xác thực JWT từ query param (`split('?token=')[1]`) + kiểm tra Redis blocklist
  - `clients = new Map()` — userId → WebSocket, sống trong RAM
  - Membership check chống IDOR trước khi relay
  - Lưu DB trước, relay sau — đảm bảo không mất tin khi sập
  - Online status broadcast (`presence: online/offline`)
  - Xử lý multi-tab: đóng socket cũ khi mở kết nối mới
  - `safeSend()` — kiểm tra `readyState === OPEN` trước khi gửi
  - `broadcast()` — duyệt Map, loại trừ người gây event
  - Hoisting: `initWebSocket` dùng `onConnect` trước khi khai báo — hợp lệ với function declaration
  - `.catch()` thay `try/catch` trên async callback của event emitter
- ✅ backend/server.js — nâng cấp `app.listen()` → `http.createServer()` + `initWebSocket()`
- ✅ backend/test-ws.js — script test 7 kịch bản, tất cả pass:
  - Kết nối + nhận onlineUsers
  - Ping/Pong
  - Alice gửi tin → Bob nhận real-time + Alice nhận ACK
  - Type không hợp lệ → lỗi mô tả rõ
  - JSON không hợp lệ → không crash
  - Bob offline → Alice nhận presence offline
  - Gửi tin khi Bob offline → lưu DB thành công, không crash
- ✅ Cập nhật ARCHITECTURE.md, CLAUDE.md — xóa Redis Pub/Sub, ghi hạn chế vào báo cáo

---

### Kiến thức kỹ thuật học được (session 4–5)

**JavaScript / Node.js:**
- **Hoisting**: `function declaration` được đưa lên đầu bộ nhớ trước khi chạy → dùng trước khai báo hợp lệ. `const/arrow function` thì không hoisting.
- **Async error handling trên event emitter**: `wss.on('connection', cb)` không xử lý Promise reject từ async callback → phải dùng `.catch()` hoặc `try/catch` bên trong.
- **`.catch()` vs `try/catch`**: tương đương nhau, `.catch()` dùng khi gọi Promise từ bên ngoài async function.
- **`Map` vs object `{}`**: Map có `.get()`, `.set()`, `.delete()`, key có thể là bất kỳ kiểu nào, duyệt bằng `for...of`.
- **Spread có điều kiện**: `...(x != null && { x })` — chỉ thêm trường vào object nếu có giá trị.
- **So sánh tham chiếu** (`===` trên object): so sánh xem 2 biến trỏ đến cùng 1 đối tượng trong bộ nhớ, không phải so sánh giá trị.
- **`[...iterator]`**: spread operator chuyển iterator (Map.keys()) thành mảng thường.

**WebSocket:**
- **Event emitter của `ws`**: `wss.on('connection')`, `ws.on('message')`, `ws.on('close')`, `ws.on('error')` — `error` bắt buộc phải đăng ký, không có thì Node.js crash.
- **`readyState`**: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED — luôn kiểm tra trước khi `.send()`.
- **`http.createServer(app)`**: tạo HTTP server thủ công để gắn WS và Express cùng cổng 3000. `app.listen()` không cho phép truy cập vào HTTP server bên trong.
- **Thời điểm kết nối WS**: ngay khi trang Chat load, không phải khi bắt đầu gõ tin.
- **`req.url`**: chỉ chứa path + query string, không có scheme/host/port.

**Kiến trúc:**
- **In-memory Map relay**: đủ cho 1 server instance, đơn giản, không cần Redis Pub/Sub.
- **Lưu DB trước relay**: an toàn hơn (không mất tin khi crash), chậm hơn 5–15ms — chấp nhận được cho đồ án.
- **B offline**: tin vẫn lưu DB → B load lịch sử khi online là thấy, không cần xử lý thêm.
- **UV Thread Pool**: xử lý tác vụ CPU-heavy (bcrypt, crypto). **Connection Pool**: quản lý kết nối TCP đến PostgreSQL. Hai thứ độc lập nhau.
- **PostgreSQL write**: ~1–5ms local, connection pool mặc định 10 là đủ cho đồ án — thêm connection không tự động nhanh hơn.

---

**Ngày 11 (17/05)**
- ✅ schema.prisma — đổi `KeyBundle.opkPubs`: `String[]` → `Json[]` (mỗi phần tử `{ id, pub }` thay vì chỉ string pub)
- ✅ schema.prisma — thêm `Message.ikPub String?` (Bob cần IK_pub của Alice để tính DH1 trong X3DH receiver)
- ✅ backend/routes/keys.js — thêm `isValidOpkArray()` validate cấu trúc `{ id, pub }` thay vì chỉ check length
- ✅ backend/routes/keys.js — sửa `GET /keys/:userId`: trả `opkPub: firstOpk.pub` và `opkId: firstOpk.id` (trước đó trả sai `opkId: bundle.id`)
- ✅ Cập nhật ARCHITECTURE.md, CRYPTO_MAP.md, PROJECT_BRIEF.md đồng bộ với code thực tế
- ✅ Ghi chú FE checklist: phải gọi `verifySignedPreKey` trước X3DH, format `wrappedOPKs[]` trong IndexedDB, sender flow đầy đủ

---

**Ngày 12–13 (22/05–23/05) — Frontend bắt đầu**

**Spec & Kiến trúc FE:**
- ✅ Viết FRONTEND_SPEC.md hoàn chỉnh: 10 phần, đặc tả từng hàm, interface, luồng, câu hỏi GV
- ✅ Cập nhật FRONTEND_SPEC.md với 13 thay đổi quan trọng:
  - PBKDF2 chỉ chạy 1 lần → `deriveWrappingKey()` trả `wrappingKey`, không derive lại mỗi lần wrap
  - `wrapPrivateKey` nhận `CryptoKey` thay vì `password string`
  - `SK extractable: true` → có thể `exportKey('raw')` để lưu IndexedDB
  - `sessionKeys` (Map) quản lý ở `Chat.jsx`, truyền vào `useWebSocket`
  - `peerIKPub` lấy từ cache `listConversations`, không fetch thêm API
  - Single-device limitation + export/import `.e2ee` file
  - Avatar dùng 2 chữ cái + màu hash toàn bộ `userId`
- ✅ Cập nhật ARCHITECTURE.md: thêm Frontend Architecture, Luồng 7 (chuyển thiết bị), Frontend Crypto Flow, Known Limitations, sửa Luồng 1 & 2

**Setup Frontend:**
- ✅ Vite + React 18 scaffold
- ✅ Cài dependencies: `libsodium-wrappers`, `dexie`, `react-router-dom`, `tailwindcss`
- ✅ Cấu hình `vite.config.js` với `@tailwindcss/vite` plugin
- ✅ Tạo folder structure: `src/crypto/`, `src/db/`, `src/services/`, `src/contexts/`, `src/hooks/`, `src/pages/`, `src/components/`
- ✅ `.env` với `VITE_API_URL` và `VITE_WS_URL`

**Crypto Layer (4 file) — 11/11 test PASS:**
- ✅ `src/crypto/keyGen.js`:
  - `generateIdentityKey()` → Ed25519 keypair: `IK_pub` (32B) + `IK_secret` (64B)
  - `generateSignedPreKey(IK_secret)` → X25519 keypair + Ed25519 signature
  - `generateOneTimePreKeys(100)` → 100 X25519 keypair với UUID riêng
  - `deriveWrappingKey(password, salt)` → PBKDF2-SHA256 600k iterations → AES-GCM CryptoKey
  - `wrapPrivateKey(privKey, wrappingKey)` → AES-GCM encrypt → `{ wrapped, iv }` base64
  - `unwrapPrivateKey(wrapped, iv, wrappingKey)` → Uint8Array gốc
- ✅ `src/crypto/x3dh.js`:
  - `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)` → Ed25519 verify
  - `performX3DH_sender(myKeys, bobBundle)` → 4 DH + HKDF → `{ SK, EK_pub }`
  - `performX3DH_receiver(myKeys, initMsg)` → 4 DH ngược + HKDF → `{ SK }`
  - SK import với `extractable: true`; xóa key tạm bằng `.fill(0)` sau khi dùng
- ✅ `src/crypto/aesGcm.js`:
  - `encryptMessage(plaintext, SK, conversationId, senderId)` → `{ ciphertext, iv, aad }`
  - `decryptMessage(ciphertextB64, ivB64, aad, SK)` → plaintext hoặc `null`
- ✅ `src/crypto/fingerprint.js`:
  - `generateFingerprint(IK_pub_A, IK_pub_B)` → sort + SHA-512 × 5200 → 60 chữ số

---

**Ngày 14 (28/05) — Pre-approved Email Whitelist**
- ✅ `schema.prisma` — thêm model `AllowedEmail` (id, email, usedAt, createdAt) + field `email @unique` vào `User`
- ✅ Migration `20260528000000_add_allowed_email` — xử lý 11 user cũ không có email bằng placeholder, áp dụng thành công
- ✅ `npx prisma generate` — regenerate Prisma client với model mới
- ✅ `backend/routes/auth.js` — sửa `POST /auth/register`:
  - Nhận thêm `email` từ `req.body`
  - Check whitelist `AllowedEmail` → 403 nếu không có
  - Check `usedAt === null` → 409 nếu đã dùng
  - Bọc `user.create` + `allowedEmail.update` trong `prisma.$transaction` chống race condition
- ✅ `backend/scripts/add-employee.js` — CLI cho IT Admin thêm email vào whitelist, xử lý lỗi P2002 (trùng email)
- ✅ Test 5 case: thiếu email (400), không trong whitelist (403), đăng ký thành công (201), đăng ký lại cùng email (409), cùng email username khác (409) — tất cả pass

---

**Ngày 15 (05/06) — Frontend tiếp tục**
- ✅ Thảo luận kiến trúc token storage: đổi từ RAM-only sang localStorage để hỗ trợ Unlock Modal
- ✅ Cập nhật `FRONTEND_SPEC.md` — 6 thay đổi quan trọng:
  - Token, userId, username chuyển sang `localStorage`
  - Thêm `isLocked` state và hàm `unlock(password)` vào AuthContext
  - ProtectedRoute logic mới: 3 nhánh (unauthenticated / locked / unlocked)
  - Thêm spec đầy đủ cho component `UnlockModal` (mới)
  - Sửa `login()`: bỏ "load all sessions" (lazy-load là đúng), thêm lưu localStorage
  - Cập nhật checklist item 11 đúng với unlock modal flow
- ✅ Cập nhật `ARCHITECTURE.md` — bổ sung 2 endpoint còn thiếu:
  - `DELETE /conversations/:convId`
  - `DELETE /messages/:messageId`
- ✅ `src/db/storage.js` — hoàn thành (đã xong từ session trước, cập nhật trạng thái)
- ✅ `src/services/api.js` — 15 hàm, đủ 15 REST endpoint:
  - Auth: register, login, logout
  - Keys: uploadKeys, fetchKeyBundle, uploadMoreOPKs, rotateSpk
  - Conversations: createConversation, listConversations, verifyFingerprint, deleteConversation
  - Messages: sendMessage, loadMessages, deleteMessage
  - Users: searchUsers

---

**Ngày 16 (05/06) — Review & fix code + spec**

- ✅ Review `src/services/api.js` — xác nhận 15 hàm đúng, không có bug
- ✅ Sửa bug `src/db/storage.js`:
  - Bỏ `wrapPrivateKey(IK_pub, ...)` — IK_pub là public key, không cần wrap
  - Bỏ param `IK_pub` khỏi `savePrivateKeys()` — không cần lưu riêng
  - Trong `loadPrivateKeys()`: đổi `unwrapPrivateKey(wrappedIKPub...)` → `IK_pub = IK_secret.slice(32)`
    (Ed25519 secret = seed 32B + pub 32B → pub recover được từ secret)
  - Sửa JSDoc `opkList`: `Uint8Array[]` → `Array<{id: string, OPK_priv: Uint8Array}>`
- ✅ Đồng bộ `FRONTEND_SPEC (2).md` với code thực tế — 10 nhóm sai lệch được sửa:
  - `keyGen.js`: `generateIdentityKey` dùng Ed25519 (không phải X25519), output `IK_secret`
  - `keyGen.js`: tách `deriveWrappingKey(password, salt)` ra riêng; `wrapPrivateKey(privKey, wrappingKey)` không trả `salt`; `unwrapPrivateKey` nhận `wrappingKey` thay vì `password`
  - `x3dh.js`: input `IK_secret` (không phải `IK_priv`), convert Ed25519→X25519 bên trong; output thêm `OPK_id`, `IK_pub`; receiver nhận `OPK_priv` đơn lẻ (không phải Map)
  - `storage.js`: schema dùng 1 `wrapSalt` chung (không có `saltIK`, `saltSPK`); signature tất cả 4 hàm đúng với code
  - `api.js`: `apiFetch` đọc body 1 lần; thêm `rotateSpk`, `deleteConversation`, `deleteMessage`
  - `AuthContext`: thứ tự `register()` đúng (api.register trước, lấy userId, rồi savePrivateKeys); `unlock()` gọi `loadPrivateKeys` thay vì unwrap thủ công 3 lần
  - `UnlockModal`: bỏ reference `wrappedIKPub`/`ivIKPub` đã xóa
  - Đổi `IK_priv` → `IK_secret` toàn bộ phần AuthContext/Chat state (giữ `IK_priv` trong pseudocode x3dh là biến tạm X25519)
- ✅ Thảo luận kỹ thuật: Salt (PBKDF2) vs IV (AES-GCM) — mục đích và lý do thiết kế tách riêng

---

**Ngày 17 (05/06) — AuthContext.jsx**
- ✅ Sửa `backend/routes/auth.js` — `POST /auth/register` trả thêm `userId` trong 201 response
  (capture `newUser` từ `prisma.$transaction`, cần để FE dùng làm primary key IndexedDB)
- ✅ Thêm `getWrapSalt(userId)` vào `src/db/storage.js`
  (giải quyết vấn đề gà-trứng: cần salt trước khi derive wrappingKey, mà wrappingKey cần trước loadPrivateKeys)
- ✅ `src/contexts/AuthContext.jsx` — hoàn thành 4 hàm + useAuth hook:
  - `register()`: sinh IK/SPK/OPK → deriveWrappingKey → api.register lấy userId → savePrivateKeys
  - `login()`: api.login → hasPrivateKeys → getWrapSalt → deriveWrappingKey → loadPrivateKeys
              → derive lại public key từ private (scalarmult_base, sign_detached) → uploadKeys (409 bỏ qua)
              → set localStorage + RAM state
  - `unlock()`: getWrapSalt → deriveWrappingKey → loadPrivateKeys → set RAM state (không gọi server)
  - `logout()`: api.logout → xóa localStorage → clear RAM (không xóa IndexedDB)
  - State: token/userId/username (localStorage) + wrappingKey/IK_secret/IK_pub/SPK_priv (RAM)
  - Derived: isAuthenticated, isLocked (= có token nhưng wrappingKey null → hiện UnlockModal)

---

---

**Ngày 18 (06/06) — Routing + Auth UI hoàn chỉnh + End-to-end test**

- ✅ `src/App.jsx` — routing React Router v6 + `ProtectedRoute` 3 nhánh (unauthenticated / locked / unlocked) + `ChatPlaceholder` tạm
- ✅ `src/pages/Login.jsx` — form đăng nhập, loading state, xử lý `DEVICE_NOT_REGISTERED`, error message
- ✅ `src/pages/Register.jsx` — form đăng ký 4 field, validate confirm password client-side, loading "Đang sinh key mã hóa...", success screen 2.5s
- ✅ `src/components/UnlockModal.jsx` — overlay sau reload, không có nút đóng, gọi `unlock()`, xử lý sai password
- ✅ `vite.config.js` — thêm Vite proxy `/api → localhost:3000` và `/ws → ws://localhost:3000` để tránh CORS issue trên browser thật
- ✅ `frontend/.env` — đổi `VITE_API_URL=/api`, `VITE_WS_URL=/ws`
- ✅ `backend/routes/auth.js` — thêm check email đã tồn tại trong bảng User (trả 409 thay vì 500)
- ✅ `frontend/src/services/api.js` — fix `apiFetch`: wrap `res.json()` trong try/catch, hiện "Không kết nối được server" thay vì lỗi kỹ thuật khi backend crash
- ✅ End-to-end test Playwright 13/13 PASS:
  - Đăng ký → thành công, redirect `/login`
  - Đăng nhập → vào `/chat`
  - Reload → `UnlockModal` hiện đúng
  - Unlock đúng password → modal biến mất
  - Unlock sai password → lỗi rõ ràng, modal vẫn mở
  - Đăng xuất → redirect `/login`, localStorage sạch
  - Đăng ký user thứ 2
  - Email không trong whitelist → bị từ chối
  - Đăng nhập sai password → bị từ chối
  - Đăng nhập trên browser không có key → `DEVICE_NOT_REGISTERED`
- ✅ Test thủ công trên browser thật — toàn bộ flow hoạt động đúng

---

---

**Ngày 19 (07/06) — WebSocket layer + Message hooks**

- ✅ `src/services/socket.js` — WebSocket singleton:
  - Build URL từ `window.location` (tự thích nghi dev/prod, http→ws, https→wss)
  - `connectSocket(token)` / `disconnectSocket()` / `sendSocketMessage(payload)`
  - `onSocketEvent(type, cb)` / `offSocketEvent(type)` — Map<eventType, callback>
  - Reconnect tự động sau 3s khi mất mạng, `intentionalClose` flag chống reconnect khi logout
  - Ping keepalive mỗi 30s, `clearInterval` khi disconnect để không leak timer

- ✅ `src/db/storage.js` — thêm `getOPK(userId, opkId, wrappingKey)`:
  - Chỉ unwrap đúng 1 OPK theo opkId (1 AES-GCM decrypt) thay vì unwrap toàn bộ 100 OPK
  - Dùng trong X3DH receiver thay cho `loadPrivateKeys` — nhanh hơn ~100×
  - IK_secret và SPK_priv đã có sẵn trong RAM (AuthContext) → không cần load lại

- ✅ `src/hooks/useWebSocket.js` — WebSocket hook:
  - `useRef` cho wrappingKey/IK_secret/SPK_priv/userId để tránh stale closure trong handler
  - Kết nối khi mount, ngắt khi unmount, chỉ re-run effect khi token thay đổi
  - Xử lý `connected` → set isConnected + onlineUsers (Set<userId>)
  - Xử lý `presence` → functional update Set (tránh capture giá trị cũ)
  - Xử lý `message` → getSK (RAM cache → IndexedDB) → X3DH receiver nếu có ekPub → decrypt → callback
  - X3DH receiver dùng `getOPK` (1 decrypt), lưu SK vào IndexedDB + sessionKeysRef, xóa OPK
  - Return: `{ onlineUsers, isConnected, onNewMessage, sessionKeysRef }`
  - `sessionKeysRef` expose ra ngoài để Chat.jsx dùng chung khi gửi tin

- ✅ `src/hooks/useMessages.js` — Message history hook:
  - Nhận `(conversationId, sessionKeysRef)` — chia sẻ SK cache với useWebSocket
  - Reset state + reload khi chuyển conversation
  - `getSK()`: RAM cache → IndexedDB → ghi vào cache
  - `fetchBatch()`: load 20 tin, pre-pass tìm tin X3DH init (có ekPub) để lấy SK trước, rồi `Promise.all` decrypt song song
  - Server trả newest-first → `reverse()` để hiển thị cũ → mới từ trên xuống
  - `loadMore()`: load batch cũ hơn bằng cursor, prepend lên đầu danh sách
  - `addMessage(msg)`: nhận tin real-time từ useWebSocket, check trùng msgId trước khi thêm
  - Return: `{ messages, isLoading, hasMore, loadMore, addMessage }`

**Quyết định kỹ thuật quan trọng session 12:**
- `sessionKeysRef` (Map) sống trong `useWebSocket`, expose sang `useMessages` để chia sẻ SK cache — tránh đọc IndexedDB 2 lần cho cùng 1 conversation
- Pre-pass tìm ekPub trong batch: server trả newest-first nên tin X3DH init nằm cuối mảng → phải tìm trước rồi mới decrypt song song
- Known limitation: nếu Bob offline từ đầu, chưa bao giờ mở conversation, và conversation tích lũy nhiều batch thì batch đầu không có ekPub → cần load nhiều batch. Thực tế không xảy ra vì người off hoàn toàn không thể có hàng ngàn tin chưa đọc.

---

**Session 20 (07/06) — Chat UI hoàn chỉnh + E2E test 12/12 PASS**

- ✅ `src/components/Avatar.jsx` — hash userId → HSL hue, 2 initials uppercase
- ✅ `src/components/ConversationItem.jsx` — online dot, thời gian, cảnh báo "Chưa xác minh danh tính"
- ✅ `src/components/FingerprintModal.jsx` — SHA-512 × 5200, hiển thị 60 chữ số chia 6 nhóm × 10, gọi `api.verifyFingerprint` khi xác nhận
- ✅ `src/components/MessageList.jsx` — auto-scroll, infinite scroll (cursor pagination), group tin cùng người gửi, hiển thị lỗi giải mã
- ✅ `src/components/MessageInput.jsx` — auto-resize textarea, Enter gửi / Shift+Enter xuống dòng, disabled khi chưa verify fingerprint
- ✅ `src/components/ChatSidebar.jsx` — search debounce 400ms, `onConvCreated` callback để reload peer.ikPub
- ✅ `src/pages/Chat.jsx` — orchestrator: useWebSocket + useMessages + X3DH sender + getOrCreateSK (RAM → IndexedDB → X3DH) + optimistic UI
- ✅ `src/App.jsx` — thay ChatPlaceholder bằng import Chat thật
- ✅ **Bug fix 1**: FingerprintModal không mở được khi tạo conv qua search → `ikPub: null` trong object tạm → thêm `onConvCreated` callback, Chat.jsx reload danh sách để lấy `peer.ikPub` từ server
- ✅ **Bug fix 2**: POST /messages lưu DB nhưng không relay WebSocket đến receiver → import `clients` Map từ `ws/handler.js`, thêm relay trong `routes/messages.js`
- ✅ **Bug fix 3**: `GET /conversations` không trả `peer.ikPub` → thêm `keyBundle: { select: { ikPub: true } }` trong Prisma join
- ✅ **E2E Playwright 12/12 PASS**: register × 2 → login × 2 → search → tạo conv → fingerprint verify → gửi tin X3DH → Bob load history + decrypt → Bob verify + reply → Alice nhận reply real-time → tin thứ 2 (SK cached)
- ✅ `backend/routes/conversations.js` — thêm `peer.ikPub` vào response `GET /conversations`

**Quyết định kỹ thuật session 20:**
- `onConvCreated(conversationId, peerId)`: khi tạo conv mới qua search, reload toàn bộ danh sách thay vì dùng object tạm. Chi phí 1 API call nhỏ, đổi lại `peer.ikPub` đúng ngay lập tức → FingerprintModal hoạt động
- `clients` Map export từ `ws/handler.js` → dùng chung ở `routes/messages.js` (không circular vì messages.js không require handler.js)
- `activeConvIdRef` + `addMessageRef`: useRef để callback `onNewMessage` đăng ký 1 lần nhưng luôn đọc giá trị mới nhất, tránh stale closure

---

---

**Session 21–23 (08/06/2026) — Docker + Group Chat + UX fix**

**Docker Compose hoàn chỉnh:**
- ✅ `backend/Dockerfile` — Node.js 20-alpine, `prisma generate` + `prisma migrate deploy` khi khởi động
- ✅ `frontend/Dockerfile` — multi-stage: Vite build → Nginx serve static
- ✅ `frontend/nginx.conf` — reverse proxy `/api` → backend:3000, `/ws` WebSocket, SPA fallback
- ✅ `backend/.dockerignore` + `frontend/.dockerignore`
- ✅ `docker-compose.yml` — 4 service: postgres + redis + backend + frontend, healthcheck, `docker compose up --build` chạy toàn bộ hệ thống
- ✅ Expose port 5432 để TablePlus kết nối được vào PostgreSQL trong Docker

**Group Chat E2EE (N tin 1-1 song song):**
- ✅ `prisma/schema.prisma` — thêm model `Group`, `GroupMember`; sửa `Message` thêm `groupId?`, `recipientId?`; index + unique constraint chống replay attack cho group
- ✅ Migration `20260608101257_add_group` — apply thành công
- ✅ `backend/routes/groups.js` — 5 endpoint: tạo nhóm, danh sách nhóm, lấy thành viên, thêm thành viên (admin only), xóa thành viên (admin only)
- ✅ `backend/routes/messages.js` — sửa `POST /messages` xử lý cả 1-1 lẫn group (N bản mã song song), thêm `GET /messages/group/:groupId`
- ✅ `backend/server.js` — mount `groupRoutes`
- ✅ `frontend/src/services/api.js` — thêm `sendGroupMessage`, `loadGroupMessages`, `createGroup`, `listGroups`, `getGroupMembers`, `addGroupMember`, `removeGroupMember`
- ✅ `frontend/src/components/CreateGroupModal.jsx` — modal tạo nhóm: tìm kiếm thành viên, chọn nhiều người, đặt tên
- ✅ `frontend/src/components/GroupItem.jsx` — item nhóm trong sidebar
- ✅ `frontend/src/components/ChatSidebar.jsx` — tab "Tin nhắn" / "Nhóm", nút tạo nhóm
- ✅ `frontend/src/hooks/useWebSocket.js` — thêm `handleGroupIncoming`, `onNewGroupMessage`; SK cache key = `${groupId}:${senderId}`
- ✅ `frontend/src/hooks/useMessages.js` — thêm param `groupId`, `fetchGroupBatch` (SK per sender)
- ✅ `frontend/src/pages/Chat.jsx` — `getOrCreateGroupSK`, `handleSendGroup`, `handleSelectGroup`, group state, peersMap cho group
- ✅ **Test thực tế**: tạo nhóm 3 người, gửi/nhận tin E2EE thành công

**UX fix:**
- ✅ `MessageInput.jsx` — sau khi gửi tin, con trỏ tự focus lại vào ô chat (dùng `useEffect` theo dõi `isSending`)

**Quyết định kỹ thuật session 21–23:**
- SK group cache key = `${groupId}:${recipientId}` (sender) / `${groupId}:${senderId}` (receiver) — tách biệt hoàn toàn với SK 1-1
- AAD group message = `${groupId}:${senderId}` — chống tamper, nhất quán giữa sender và receiver
- Group không cần fingerprint — đơn giản hóa UX, phù hợp scope đồ án
- `prisma migrate dev` chạy trên máy local (có terminal tương tác) → `prisma migrate deploy` trong Docker container
- Rebuild container khi sửa code: `docker compose up --build -d <service>`

---

---

**Session 24–25 (08/06/2026) — Gửi file/ảnh E2EE + Clipboard paste**

**Gửi file & ảnh E2EE:**
- ✅ `prisma/schema.prisma` — thêm model `UploadedFile` (id, uploaderId, createdAt); thêm relation `uploadedFiles` vào `User`
- ✅ Migration `20260608105408_add_uploaded_file` — apply thành công
- ✅ `backend/routes/files.js` — **mới**: `POST /files/upload` (multer, max 10MB, memoryStorage → ghi disk bằng UUID) + `GET /files/:fileId` (trả encrypted bytes)
- ✅ `backend/server.js` — mount `/files` route
- ✅ `docker-compose.yml` — thêm volume `uploads_data:/app/uploads` để file tồn tại qua container restart
- ✅ `frontend/src/crypto/aesGcm.js` — thêm 4 hàm mới:
  - `encryptBytes(bytes, SK)` — mã hóa bytes bằng SK (dùng cho 1-1)
  - `encryptBytesWithRandomKey(bytes)` — sinh random fileKey, mã hóa 1 lần dùng cho N người (dùng cho group)
  - `decryptBytes(encryptedBytes, fileIvB64, SK)` — giải mã bằng SK (1-1)
  - `decryptBytesWithKey(encryptedBytes, fileIvB64, fileKeyB64)` — giải mã bằng fileKey (group)
- ✅ `frontend/src/services/api.js` — thêm `uploadFile(token, encryptedBytes)` (FormData) + `downloadFile(token, fileId)` (ArrayBuffer → Uint8Array)
- ✅ `frontend/src/components/MessageInput.jsx` — thêm nút đính kèm (paperclip icon), hidden file input, validate 10MB client-side
- ✅ `frontend/src/pages/Chat.jsx` — thêm 3 hàm:
  - `handleSendFile(file)` — mã hóa bằng SK, upload, gửi message payload JSON (1-1)
  - `handleSendGroupFile(file)` — dùng random fileKey, upload 1 lần, gửi fileKey trong message payload từng người (group)
  - `handleDownloadFile(fileInfo, senderId)` — download + decrypt → trả Blob URL
- ✅ `frontend/src/components/MessageList.jsx` — thêm component `FileBubble`:
  - Ảnh: tự tải và hiển thị inline, click mở toàn màn hình
  - File: icon + tên + dung lượng + click để tải xuống (spinner khi đang decrypt)
  - `parsePlaintext` mở rộng nhận diện `{ type: "file"|"image", ... }` — backward-compatible với tin nhắn cũ

**UX:**
- ✅ `MessageInput.jsx` — thêm `onPaste` handler: Ctrl+V ảnh từ clipboard → gửi ngay như file ảnh, text paste vẫn hoạt động bình thường
- ✅ Xóa tên file hiển thị bên dưới ảnh — bubble ảnh gọn hơn

**Quyết định kỹ thuật session 24–25:**
- **1-1 file**: mã hóa bằng SK conversation → server lưu 1 bản ciphertext, receiver dùng SK để decrypt
- **Group file**: sinh random 256-bit fileKey → mã hóa file 1 lần → fileKey bọc trong message payload của từng người (mã hóa bằng SK riêng) → server chỉ lưu 1 bản ciphertext, không tốn băng thông N×
- File format message payload: `JSON.stringify({ type, fileId, fileName, mimeType, fileSize, fileIv, fileKey? })` → mã hóa như tin nhắn thường → backward-compatible
- **Blind Server**: server chỉ thấy encrypted bytes, không biết loại file hay nội dung

---

### ⏳ Còn lại
- Tuần 6: báo cáo + slide + demo ← **bước tiếp theo**

---