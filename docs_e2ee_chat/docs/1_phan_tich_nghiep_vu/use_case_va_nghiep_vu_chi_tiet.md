# Phân Tích Nghiệp Vụ — E2EE Chat

---

## 1. Use Case Diagram (mức cơ bản)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Hệ thống E2EE Chat                       │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<Authentication>>                                       │   │
│   │   UC-01 Đăng ký tài khoản                                │   │
│   │   UC-02 Đăng nhập                                        │   │
│   │   UC-03 Đăng xuất                                        │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<Key Management>>                                       │   │
│   │   UC-04 Upload public key bundle                         │   │
│   │   UC-05 Lấy key bundle của người dùng khác              │   │
│   │   UC-06 Bổ sung One-Time PreKey                         │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<1-1 Chat>>                                             │   │
│   │   UC-07 Tạo cuộc trò chuyện 1-1                         │   │
│   │   UC-08 Gửi tin nhắn đầu tiên (X3DH)                    │   │
│   │   UC-09 Gửi/nhận tin nhắn tiếp theo (AES-GCM)           │   │
│   │   UC-10 Xác minh danh tính (Fingerprint)                │   │
│   │   UC-11 Tải lịch sử tin nhắn                            │   │
│   │   UC-12 Xóa tin nhắn                                    │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<Group Chat>>                                           │   │
│   │   UC-13 Tạo nhóm chat                                    │   │
│   │   UC-14 Thêm / Xóa thành viên nhóm                      │   │
│   │   UC-15 Gửi tin nhắn nhóm (N bản sao E2EE)              │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<File Transfer>>                                        │   │
│   │   UC-16 Gửi file/ảnh E2EE (1-1)                         │   │
│   │   UC-17 Gửi file/ảnh E2EE (nhóm)                        │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  <<Device Management>>                                    │   │
│   │   UC-18 Xuất backup key (.e2ee)                          │   │
│   │   UC-19 Nhập backup key sang thiết bị mới                │   │
│   └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
            ▲                           ▲
            │                           │
       ┌────┴────┐                 ┌────┴────┐
       │  User   │                 │  Admin  │
       │ (Alice/ │                 │ (thêm   │
       │  Bob)   │                 │ email)  │
       └─────────┘                 └─────────┘
```

---

## 2. Các Ca Nghiệp Vụ Chi Tiết

---

### UC-01: Đăng Ký Tài Khoản

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | User (chưa có tài khoản) |
| **Điều kiện tiên quyết** | Email đã có trong bảng `AllowedEmail` (whitelist doanh nghiệp) |
| **Kết quả mong đợi** | Tài khoản được tạo, private key lưu IndexedDB, public key lưu server |

**Luồng chính:**

1. User nhập `username`, `email`, `password` vào form Register
2. Frontend sinh bộ key:
   - `IK` (Identity Key) = Ed25519 keypair → 32B public + 64B secret
   - `SPK` (Signed PreKey) = X25519 keypair + chữ ký Ed25519 của IK lên SPK_pub
   - 100 `OPK` (One-Time PreKey) = X25519 keypair × 100, mỗi cái gán 1 UUID
3. Tính `wrapSalt` = random 16 bytes
4. Tính `wrappingKey` = PBKDF2-SHA256(password, wrapSalt, **600.000 vòng**) → AES-256-GCM key
5. Wrap (mã hóa) từng private key bằng `wrappingKey` + IV ngẫu nhiên, lưu vào IndexedDB
6. Gọi `POST /auth/register` với `{username, email, password}` → server hash password bằng BCrypt (cost 12), tạo user trong DB
7. Gọi `POST /keys/upload` với `{ikPub, spkPub, spkSig, opkPubs[]}` (tất cả base64) → server lưu vào bảng `KeyBundle`

**Luồng thay thế:**
- Email không có trong whitelist → server trả 403 "Email không được phép đăng ký"
- Username đã tồn tại → server trả 409

**Câu hỏi GV thường hỏi:**
- *Tại sao 600.000 vòng PBKDF2?* → Làm chậm brute-force: máy tính cần ~1 giây để thử 1 password thay vì 1 triệu lần/giây.
- *Private key lưu ở đâu?* → IndexedDB của trình duyệt, đã mã hóa bằng password. Server **không bao giờ** thấy private key.

---

### UC-02: Đăng Nhập

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | User đã có tài khoản |
| **Điều kiện tiên quyết** | User đã đăng ký, thiết bị đã có private key trong IndexedDB |
| **Kết quả mong đợi** | User nhận JWT, private key được tải vào RAM |

**Luồng chính:**

1. User nhập `username`, `password`
2. Gọi `POST /auth/login` → server kiểm tra BCrypt(password, hash), trả `{token, userId, username}`
3. Frontend đọc `wrapSalt` từ IndexedDB theo `userId`
4. Tính lại `wrappingKey` = PBKDF2-SHA256(password, wrapSalt, 600.000 vòng)
5. Giải mã (unwrap) các private key từ IndexedDB → `IK_secret`, `SPK_priv`, `opkMap`
6. Lưu `{token, userId, username, IK_secret, SPK_priv, wrappingKey}` vào React Context (RAM)
7. Mở WebSocket: `ws://server/ws?token=JWT`

**Luồng thay thế:**
- Thiết bị mới chưa có IndexedDB → `wrapSalt = null` → hiển thị hướng dẫn import file `.e2ee`
- Password sai → BCrypt check fail ở server → 401
- Password đúng nhưng sai wrappingKey → AES-GCM decrypt throw `DOMException` → "Sai mật khẩu"

**Quan trọng — Timing Attack:**
Server dùng `bcrypt.compare()` thay vì `===` để so sánh password. Dù user không tồn tại, server vẫn gọi `bcrypt.compare()` với hash giả để thời gian phản hồi luôn như nhau → kẻ tấn công không thể đoán username qua thời gian phản hồi.

---

### UC-03: Đăng Xuất

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | User đang đăng nhập |
| **Kết quả mong đợi** | Token bị thu hồi, private key xóa khỏi RAM |

**Luồng chính:**

1. User bấm "Đăng xuất"
2. Gọi `POST /auth/logout` với `Bearer token` → server lưu token vào Redis với key `blocklist:{token}`, TTL = thời gian còn lại của token
3. Frontend xóa `{token, IK_secret, SPK_priv, wrappingKey, sessionKeys}` khỏi RAM (React Context reset)
4. Đóng WebSocket

**Tại sao cần Redis blocklist?**
JWT là stateless — một khi đã phát hành, không thể thu hồi nếu chỉ dùng verify chữ ký. Redis blocklist giải quyết bằng cách đánh dấu token "đã dùng xong" ngay khi logout.

---

### UC-07: Tạo Cuộc Trò Chuyện 1-1

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | User A muốn nhắn tin với User B |
| **Điều kiện tiên quyết** | Cả 2 đều đã đăng ký và upload key |
| **Kết quả mong đợi** | Conversation được tạo, trả về `conversationId` |

**Luồng chính:**

1. User A tìm kiếm User B qua `GET /users?search=keyword`
2. Gọi `POST /conversations` với `{recipientId: B.userId}`
3. Server kiểm tra xem đã có conversation A↔B hay B↔A chưa (cả 2 chiều):
   - Đã có → trả về `conversationId` hiện tại (idempotent)
   - Chưa có → tạo mới, `participantA = A.userId`, `participantB = B.userId`
4. Frontend reload danh sách conversations để lấy `peer.ikPub` của B

**Tại sao idempotent?**
Tránh tạo duplicate conversation nếu user bấm nút nhiều lần hoặc mạng chậm.

---

### UC-08: Gửi Tin Nhắn Đầu Tiên (X3DH)

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | User A (Alice) |
| **Điều kiện tiên quyết** | Conversation đã tạo, **fingerprint đã verify**, chưa có Session Key |
| **Kết quả mong đợi** | Bob nhận được tin nhắn đã mã hóa, tính ra cùng Session Key |

**Luồng chính:**

1. Alice nhập tin nhắn, bấm Gửi
2. Kiểm tra RAM: chưa có SK cho `conversationId` này
3. Kiểm tra IndexedDB: chưa có session → cần thực hiện X3DH
4. Gọi `GET /keys/{bobId}` → nhận `{ikPub, spkPub, spkSig, opkPub, opkId}` (base64)
5. Verify chữ ký SPK: `Ed25519.verify(spkSig, spkPub, ikPub_bob)` → nếu false → dừng
6. Sinh `EK` (Ephemeral Key) = X25519 keypair (dùng 1 lần)
7. Tính 4 phép DH:
   - `DH1 = X25519(IK_priv_A, SPK_pub_B)` — xác thực lẫn nhau
   - `DH2 = X25519(EK_priv, IK_pub_B_x25519)` — xác thực lẫn nhau
   - `DH3 = X25519(EK_priv, SPK_pub_B)` — forward secrecy
   - `DH4 = X25519(EK_priv, OPK_pub_B)` — forward secrecy (OPK)
8. `IKM = 0xFF×32 || DH1 || DH2 || DH3 || DH4` (160 bytes)
9. `SK = HKDF-SHA256(IKM, salt=0×32, info="E2EEChat_v1")` → AES-256-GCM key
10. Xóa `DH1..DH4`, `EK_priv`, `IK_priv` (X25519 variant) khỏi RAM
11. Mã hóa tin nhắn: `AES-256-GCM(plaintext, SK, IV_random, AAD="{convId}:{senderId}")`
12. Gửi qua WebSocket: `{conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub}`
13. Server lưu DB → relay cho Bob nếu online
14. Bob nhận → thực hiện X3DH receiver (4 phép DH ngược) → ra cùng SK → giải mã

**Câu hỏi GV:**
- *Tại sao cần 4 phép DH, không phải 1?* → Kết hợp mutual authentication (DH1, DH2) và forward secrecy (DH3, DH4). 1 phép DH không đạt được cả hai.
- *EK dùng xong thì sao?* → Xóa khỏi RAM ngay (`.fill(0)`). Kẻ tấn công dump memory sau này không tính lại được SK.

---

### UC-09: Gửi Tin Nhắn Tiếp Theo (AES-GCM)

| Thuộc tính | Nội dung |
|---|---|
| **Điều kiện tiên quyết** | SK đã có trong RAM (hoặc IndexedDB) |
| **Kết quả mong đợi** | Tin nhắn được mã hóa và giao ngay lập tức |

**Luồng chính:**

1. Lấy SK từ RAM (sessionKeys Map) hoặc load từ IndexedDB
2. `IV = random 12 bytes` — **phải random mỗi tin**, không được tái dùng
3. `AAD = "{conversationId}:{senderId}"` — không mã hóa nhưng được xác thực
4. `ciphertext = AES-256-GCM.encrypt(plaintext, SK, IV, AAD)`
5. Gửi WebSocket: `{conversationId, ciphertext, iv, aad}` (không có `ekPub/opkId/ikPub` vì đã có SK)
6. Hiển thị tin ngay (optimistic UI) — không chờ server ack

**Tại sao AAD quan trọng?**
Nếu không có AAD, attacker có thể lấy ciphertext từ conversation A và replay vào conversation B mà AES-GCM không phát hiện. Với AAD = `{convId}:{senderId}`, auth tag sẽ sai → decrypt fail.

---

### UC-10: Xác Minh Danh Tính (Fingerprint)

| Thuộc tính | Nội dung |
|---|---|
| **Tác nhân chính** | Cả Alice và Bob |
| **Điều kiện tiên quyết** | Conversation đã tạo |
| **Kết quả mong đợi** | `conversation.fingerprintVerified = true`, mở khóa tính năng chat |

**Luồng chính:**

1. Alice và Bob mỗi người mở FingerprintModal
2. Mỗi bên tính độc lập:
   - `sorted = lexicographic_sort([IK_pub_Alice, IK_pub_Bob])`
   - `combined = concat(sorted[0], sorted[1])` (64 bytes)
   - `hash = SHA-512(combined)`, lặp 5200 vòng
   - `fingerprint = BigInt(hash) % 10^60` → 60 chữ số decimal
3. Alice đọc to 60 chữ số (qua điện thoại / gặp trực tiếp), Bob so sánh với màn hình mình
4. Khớp → Alice bấm "Xác nhận" → gọi `PATCH /conversations/{convId}/fingerprint`
5. Server đặt `fingerprintVerified = true`
6. Ô nhập tin nhắn (MessageInput) được bật

**Tại sao bắt buộc verify?**
Nếu server giả mạo key bundle của Bob (MITM), fingerprint sẽ khác nhau giữa 2 người. Verify qua kênh ngoài (điện thoại) đảm bảo key là thật.

**Tại sao lặp 5200 vòng SHA-512?**
Nếu kẻ tấn công muốn tìm key giả có cùng fingerprint, phải thử hàng tỷ cặp key, mỗi cặp phải hash 5200 vòng → cực kỳ tốn thời gian.

---

### UC-15: Gửi Tin Nhắn Nhóm

| Thuộc tính | Nội dung |
|---|---|
| **Thiết kế** | "N tin 1-1 song song" — không dùng Sender Keys/MLS |
| **Kết quả mong đợi** | Mỗi thành viên nhận bản tin mã hóa riêng cho họ |

**Luồng chính:**

1. Alice gửi tin trong nhóm N người
2. Frontend gọi `POST /messages` với body:
   ```json
   {
     "groupId": "...",
     "recipients": [
       { "userId": "bob_id", "ciphertext": "...", "iv": "...", "aad": "..." },
       { "userId": "carol_id", "ciphertext": "...", "iv": "...", "aad": "..." }
     ]
   }
   ```
3. Mỗi recipient được mã hóa bằng SK riêng (1-1 session giữa Alice↔Bob, Alice↔Carol)
4. Server lưu N bản tin riêng, relay cho từng người

**Hạn chế và lý do thiết kế:**
Sender Keys (Signal) hiệu quả hơn (1 ciphertext, N người giải mã) nhưng phức tạp hơn nhiều. Với nhóm ≤20 người, N tin 1-1 vẫn chấp nhận được cho đồ án.

---

### UC-18/19: Xuất / Nhập Backup Key

| Thuộc tính | Nội dung |
|---|---|
| **Bài toán** | Private key chỉ tồn tại trên 1 thiết bị (trình duyệt đăng ký) |
| **Giải pháp** | Export file `.e2ee` — chứa private key đã mã hóa bằng password |

**Luồng xuất:**
1. `data = IndexedDB.privateKeys.get(userId)` — lấy toàn bộ wrapped keys
2. `payload = JSON.stringify({version:1, privateKeys: data, sessions: [...]})`
3. Download file `e2ee-keys-{userId_8char}.e2ee`

**Bảo mật:** File chứa ciphertext (đã mã hóa bằng password). Kẻ có file nhưng không biết password → không thể giải mã.

**Luồng nhập (thiết bị mới):**
1. User upload file `.e2ee`
2. `IndexedDB.privateKeys.put(payload.privateKeys)`
3. Đăng nhập bình thường → PBKDF2 derive wrappingKey → unwrap keys
