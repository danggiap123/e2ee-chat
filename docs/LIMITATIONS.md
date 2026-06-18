# Hạn chế và Rủi ro của Hệ thống E2EE Chat

> Tài liệu này liệt kê các hạn chế **có bằng chứng từ code thực tế** của hệ thống,
> kèm mức độ rủi ro và hướng khắc phục trong tương lai.

---

## 1. Mật mã học (Cryptographic)

### 1.1 Không có Double Ratchet — Session Key dùng lại cho toàn bộ cuộc trò chuyện

**Bằng chứng:**
- `frontend/src/db/storage.js` — bảng `sessions` lưu 1 SK duy nhất theo `conversationId`
- `frontend/src/crypto/aesGcm.js` — `encryptMessage(plaintext, SK, ...)` dùng cùng 1 SK cho mọi tin

**Mô tả:** X3DH tạo ra 1 Session Key (SK) duy nhất và lưu vào IndexedDB. Tất cả tin nhắn trong cuộc hội thoại đều được mã hóa bằng chính SK đó. Nếu SK bị lộ (ví dụ: browser bị khai thác + mật khẩu bị đoán), toàn bộ lịch sử tin nhắn của cuộc hội thoại đó có thể bị giải mã.

**So sánh:** Signal Protocol bổ sung Double Ratchet — mỗi tin nhắn sinh key mới, tin cũ không thể giải mã kể cả khi key hiện tại bị lộ (Forward Secrecy trong session).

**Giải pháp tương lai:** Triển khai Double Ratchet Protocol bên trên X3DH: mỗi lần gửi/nhận tin nhắn cập nhật chain key, sinh message key mới, xóa key cũ khỏi RAM ngay sau khi dùng.

---

### 1.2 SPK không được xoay vòng định kỳ

**Bằng chứng:**
- `frontend/src/services/api.js` — hàm `rotateSpk()` tồn tại nhưng không được gọi ở bất kỳ đâu trong frontend
- `backend/routes/keys.js:148` — endpoint `POST /keys/spk` hoạt động nhưng chưa có client trigger

**Mô tả:** Signed PreKey (SPK) được tạo 1 lần lúc đăng ký và dùng mãi. Signal khuyến nghị xoay vòng SPK hàng tuần. SPK tĩnh đồng nghĩa với: nếu SPK_priv bị lộ, các session được thiết lập từ trước đến nay đều có thể bị tính lại.

**Giải pháp tương lai:** Tự động rotate SPK mỗi 7 ngày — gọi `rotateSpk()` khi login, kiểm tra timestamp lần rotate gần nhất lưu trong IndexedDB.

---

### 1.3 Hết OPK trả lỗi 410, không có fallback

**Bằng chứng:**
- `backend/routes/keys.js:75-77`:
  ```javascript
  if (bundle.opkPubs.length === 0) {
    return res.status(410).json({ error: 'Hết OPK — Alice cần upload thêm' });
  }
  ```
- `frontend/src/services/api.js` — `uploadMoreOPKs()` tồn tại nhưng server không emit `low_opk` event khi pool gần hết

**Mô tả:** Khi OPK pool của user B cạn kiệt, user A không thể khởi tạo X3DH để chat lần đầu — nhận lỗi 410. Cơ chế tự động bổ sung OPK chưa được nối đầu cuối (server không trigger, client không tự kiểm tra).

**Giải pháp tương lai:** Sau mỗi lần `GET /keys/:userId` pop OPK, server kiểm tra nếu còn < 10 OPK thì emit `{ type: "low_opk" }` qua WebSocket đến đúng user đó; client lắng nghe và tự động sinh + upload 90 OPK mới.

---

## 2. Bảo mật Hệ thống (System Security)

### 2.1 JWT lộ trong server log qua WebSocket URL

**Bằng chứng:**
- `frontend/src/services/socket.js:33`:
  ```javascript
  const url = `${protocol}//${window.location.host}${WS_PATH}?token=${token}`;
  ```
- `backend/ws/handler.js:32`:
  ```javascript
  const token = req.url.split('?token=')[1];
  ```

**Mô tả:** JWT được đặt vào query string khi kết nối WebSocket. Do WebSocket API của browser không hỗ trợ custom header khi khởi tạo kết nối, đây là phương án phổ biến nhưng có trade-off: token xuất hiện trong nginx access log và Cloudflare dashboard log. Người có quyền truy cập hạ tầng (IT admin, DevOps) có thể đọc được token.

**Tác động thực tế:** Kẻ có JWT nhưng không biết mật khẩu **không thể giải mã tin nhắn** (không có private key trong IndexedDB). Tuy nhiên có thể: gọi REST API đọc metadata (danh sách hội thoại, thời gian), gửi ciphertext rác giả danh nạn nhân.

**Giải pháp tương lai:** Kết nối WebSocket không kèm token, sau khi handshake thành công gửi `{ type: "auth", token }` là tin nhắn đầu tiên. Server giữ kết nối ở trạng thái "chưa xác thực" cho đến khi nhận được tin auth này.

---

### 2.2 Vô hiệu hóa tài khoản không ngắt session ngay lập tức

**Bằng chứng:**
- `backend/routes/admin.js:65`:
  ```javascript
  await prisma.user.update({ where: { id }, data: { isActive: false } });
  ```
- `backend/ws/handler.js:42-56` — chỉ kiểm tra JWT và Redis blocklist **một lần duy nhất lúc kết nối**, không kiểm tra lại trong suốt session

**Mô tả:** Khi admin vô hiệu hóa tài khoản, user đang kết nối vẫn tiếp tục hoạt động bình thường — gửi/nhận tin nhắn, gọi REST API — cho đến khi tự reload trang. JWT không bị đưa vào Redis blocklist nên vẫn hợp lệ tối đa 24h.

**Giải pháp tương lai:** Khi admin disable user: (1) đưa tất cả JWT của user vào Redis blocklist (cần lưu danh sách token đang active), (2) tìm WebSocket của user trong `clients` Map và đóng với mã 4001. Hoặc đơn giản hơn: khi REST API middleware phát hiện `isActive = false`, trả 401 và client tự redirect về login.

---

### 2.3 Không có rate limiting

**Bằng chứng:** `backend/routes/auth.js` — đã xóa `express-rate-limit` vì xác định đúng IP thật qua Cloudflare Tunnel yêu cầu cấu hình phức tạp hơn scope đồ án.

**Mô tả:** Hiện tại không có giới hạn số lần thử đăng nhập. Với `bcrypt cost 12` (~300ms/lần), brute force thực tế bị làm chậm tự nhiên, nhưng không có hard stop theo IP.

**Giải pháp tương lai:** Khi deploy qua Cloudflare Tunnel, sử dụng header `CF-Connecting-IP` (IP thật của client, Cloudflare gắn vào, không giả mạo được) làm key cho rate limiter. Ở tầng nginx thêm `limit_req_zone $http_cf_connecting_ip zone=login:10m rate=10r/m`.

---

### 2.4 Xóa tin nhắn nhóm không cập nhật real-time cho các thành viên

**Bằng chứng:**
- `backend/routes/messages.js:317-334` — sau khi DELETE, chỉ gửi WebSocket event `message_deleted` cho cuộc hội thoại **1-1**:
  ```javascript
  if (message.conversationId) {        // chỉ 1-1
    // ... gửi notify cho receiver
  }
  // Không có xử lý cho message.groupId
  ```

**Mô tả:** Khi user xóa tin nhắn trong nhóm, chỉ DB bị xóa. Các thành viên khác trong nhóm không nhận được thông báo real-time — họ vẫn thấy tin nhắn đó cho đến khi reload trang.

**Giải pháp tương lai:** Sau khi DELETE group message, gọi `broadcastToGroupMembers(groupId, { type: "message_deleted", messageId, groupId })` để notify tất cả thành viên đang online.

---

### 2.5 Không có xác thực 2 yếu tố (2FA)

**Bằng chứng:** `backend/routes/auth.js` — login chỉ dùng username/password, không có bước xác thực thứ 2.

**Mô tả:** Với ứng dụng nội bộ doanh nghiệp xử lý thông tin nhạy cảm, 2FA là tiêu chuẩn tối thiểu. Nếu mật khẩu bị lộ (phishing, password reuse từ service khác), tài khoản bị chiếm hoàn toàn.

**Giải pháp tương lai:** Tích hợp TOTP (Time-based One-Time Password) theo chuẩn RFC 6238 — thư viện `otplib` phía backend, app Authenticator (Google/Microsoft) phía người dùng. Hoặc đơn giản hơn: gửi OTP qua email công ty khi đăng nhập.

---

## 3. Hạ tầng & Khả năng mở rộng

### 3.1 WebSocket relay lưu trong RAM — không thể mở rộng ngang (horizontal scaling)

**Bằng chứng:**
- `backend/ws/handler.js:12`:
  ```javascript
  const clients = new Map(); // sống trong RAM, mất khi server restart
  ```

**Mô tả:** Toàn bộ trạng thái kết nối WebSocket của 200 người dùng nằm trong RAM của 1 Node.js process. Không thể chạy 2 instance song song (load balancer phân phối sai người nhận). Nếu server khởi động lại, tất cả kết nối bị ngắt — client tự reconnect sau 3 giây (đã xử lý trong `socket.js:87`).

**Giải pháp tương lai:** Thay in-memory Map bằng Redis Pub/Sub — mỗi instance đăng ký channel của user mình đang kết nối, khi cần relay thì publish sang Redis, instance đang giữ socket đó nhận và gửi đi.

---

### 3.2 File lưu trên local disk — không có replication

**Bằng chứng:**
- `docker-compose.yml:41`: `uploads_data:/app/uploads`
- `backend/routes/files.js:39`: `fs.writeFileSync(path.join(UPLOADS_DIR, record.id), req.file.buffer)`

**Mô tả:** Encrypted file bytes lưu trên volume Docker local. Nếu volume hỏng hoặc server đổi máy, toàn bộ file đính kèm mất. Không có backup tự động.

**Giải pháp tương lai:** Thay local disk bằng object storage (MinIO self-hosted hoặc S3-compatible) — đảm bảo replication, backup, và không phụ thuộc vào 1 máy chủ cụ thể.

---

### 3.3 Không có database backup tự động

**Bằng chứng:** `docker-compose.yml` — không có cronjob backup, không có replica PostgreSQL.

**Mô tả:** 1 instance PostgreSQL duy nhất. Nếu volume `postgres_data` bị hỏng, toàn bộ dữ liệu (users, messages, keys) mất vĩnh viễn.

**Giải pháp tương lai:** Thêm cronjob chạy `pg_dump` hàng ngày, lưu backup vào storage riêng. Hoặc dùng PostgreSQL streaming replication (primary + standby).

---

### 3.4 Môi trường triển khai phụ thuộc vào máy cá nhân

**Bằng chứng:** `docker-compose.yml:56-61` — cloudflared tunnel chỉ hoạt động khi máy chủ cá nhân đang bật và kết nối internet ổn định. Không có VPS, không có uptime guarantee.

**Mô tả:** Domain `chat.danggiap.id.vn` hoạt động chỉ khi máy cá nhân đang chạy Docker Compose. Mất điện, mất mạng, hoặc máy tắt → toàn bộ 200 người dùng mất kết nối.

**Giải pháp tương lai:** Deploy lên VPS (DigitalOcean, Vultr, hoặc server nội bộ doanh nghiệp) với uptime SLA, đảm bảo dịch vụ 24/7.

---

## 4. Tính năng & Trải nghiệm Người dùng

### 4.1 Private key chỉ tồn tại trên 1 trình duyệt duy nhất

**Bằng chứng:**
- `frontend/src/db/storage.js:6`: `const db = new Dexie('E2EEChatDB')` — IndexedDB per-browser, per-origin
- `backend/routes/auth.js` — login kiểm tra `hasPrivateKeys(uid)`, nếu trình duyệt khác → `DEVICE_NOT_REGISTERED`

**Mô tả:** Khi user đăng ký trên Chrome, private key lưu trong Chrome's IndexedDB. Mở Firefox hoặc máy tính khác → không có key → không đăng nhập được. Nếu xóa browser data → mất key vĩnh viễn, không thể phục hồi.

**Đã có cơ chế export/import:** `storage.js:exportKeysToFile()` cho phép xuất file `.e2ee` (vẫn mã hóa bằng password). Tuy nhiên UI chưa hướng dẫn người dùng backup ngay sau đăng ký.

**Giải pháp tương lai:** Hiển thị thông báo bắt buộc sau đăng ký thành công, yêu cầu user tải file backup `.e2ee`. Thêm reminder định kỳ nếu chưa backup.

---

### 4.2 Group chat không có Forward Secrecy — file key trong ciphertext

**Bằng chứng:**
- `frontend/src/crypto/aesGcm.js:18-32` — `encryptBytesWithRandomKey()` sinh `fileKey` ngẫu nhiên
- File key này được nhúng vào ciphertext message của mỗi thành viên

**Mô tả:** Khi gửi file trong nhóm, 1 `fileKey` ngẫu nhiên được sinh ra và đính kèm trong mỗi bản mã gửi cho từng thành viên. Nếu SK của 1 thành viên bị lộ, kẻ tấn công giải mã được message → lấy được `fileKey` → giải mã file. File và nội dung text có cùng mức bảo vệ.

---

### 4.3 Không có tìm kiếm tin nhắn

**Mô tả:** Vì tin nhắn được E2EE, server không thể tìm kiếm nội dung. Client cũng chưa có tính năng search local. Với lịch sử dài, user không thể tìm lại tin nhắn cũ theo từ khóa.

**Giải pháp tương lai:** Client-side search — giải mã và index tin nhắn trong bộ nhớ trình duyệt (IndexedDB), dùng full-text search library như `flexsearch` hoàn toàn local, không gửi gì lên server.

---

### 4.4 Corporate NAT — IP-based security không phân biệt được từng người

**Bằng chứng:** `backend/ws/handler.js` và `backend/routes/auth.js` — không có cơ chế nào dựa vào IP để phân biệt user trong cùng mạng nội bộ.

**Mô tả:** Nếu 200 nhân viên ngồi trong văn phòng, tất cả chia sẻ 1 IP public qua NAT của công ty. Mọi biện pháp bảo mật dựa trên IP (rate limiting, geo-block, anomaly detection) sẽ không phân biệt được người dùng cá nhân. Một người vi phạm ảnh hưởng đến toàn bộ văn phòng.

---

## Tóm tắt mức độ ưu tiên

| # | Hạn chế | Mức độ | Phức tạp để fix |
|---|---|---|---|
| 2.2 | Disable không ngắt session | 🔴 Cao | Trung bình |
| 2.1 | JWT trong WebSocket URL | 🔴 Cao | Trung bình |
| 1.1 | Không có Double Ratchet | 🟠 Trung bình | Rất cao |
| 1.2 | SPK không rotate | 🟠 Trung bình | Thấp |
| 1.3 | OPK hết không tự bổ sung | 🟠 Trung bình | Thấp |
| 2.3 | Không có rate limiting | 🟠 Trung bình | Trung bình |
| 2.4 | Xóa tin nhóm không real-time | 🟡 Thấp | Thấp |
| 2.5 | Không có 2FA | 🟠 Trung bình | Trung bình |
| 3.1 | WebSocket không scale ngang | 🟡 Thấp | Cao |
| 3.2 | File lưu local disk | 🟡 Thấp | Trung bình |
| 3.3 | Không backup DB | 🟡 Thấp | Thấp |
| 3.4 | Phụ thuộc máy cá nhân | 🟡 Thấp (demo) | Cao |
| 4.1 | Key chỉ trên 1 browser | 🟠 Trung bình | Cao |
| 4.3 | Không có search | 🟢 Rất thấp | Trung bình |
