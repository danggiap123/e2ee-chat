# Lộ Trình Chuẩn Bị Bảo Vệ Tốt Nghiệp — E2EE Chat

> **Mục tiêu:** Trả lời được MỌI câu hỏi của thầy về code, tham số, thuật toán — không phải thuộc lòng mà phải **hiểu tại sao**.
> 
> **Nguyên tắc học:** Mỗi con số, mỗi dòng code phải có lý do. "Em làm theo tutorial" không phải câu trả lời chấp nhận được.

---

## Mục Lục

1. [Tổng quan lộ trình 4 tuần](#tổng-quan)
2. [Chủ đề A — Cryptography (trọng tâm bảo vệ)](#chu-de-a)
3. [Chủ đề B — Backend & Database](#chu-de-b)
4. [Chủ đề C — Frontend & Key Management](#chu-de-c)
5. [Chủ đề D — Kiến trúc & Quyết định thiết kế](#chu-de-d)
6. [Bộ câu hỏi thầy thường hỏi + đáp án mẫu](#cau-hoi)
7. [Checklist chuẩn bị meeting hàng tuần](#meeting)
8. [Cách xử lý khi bị hỏi bất ngờ](#xu-ly)

---

<a name="tổng-quan"></a>
## 1. Tổng Quan Lộ Trình 4 Tuần

```
Tuần 1 (ưu tiên cao nhất): Crypto deep dive
  → X3DH từng tham số, AES-GCM, PBKDF2, fingerprint
  → Mục tiêu: giải thích được từng con số trong code

Tuần 2: Backend mechanics
  → bcrypt, JWT, Redis, cursor pagination, PostgreSQL transactions
  → Mục tiêu: vẽ được sequence diagram từ đầu đến cuối

Tuần 3: Frontend & security model
  → IndexedDB, RAM management, wrappingKey, XSS vs privacy trade-off
  → Mục tiêu: giải thích được tại sao mỗi key sống ở đâu

Tuần 4: Tổng hợp & mock defense
  → Known limitations + đề xuất cải tiến
  → Mục tiêu: trả lời challenge 15 phút không cần nhìn slide
```

---

<a name="chu-de-a"></a>
## 2. Chủ Đề A — Cryptography

> **Đây là phần thầy sẽ hỏi kỹ nhất.** Mỗi tham số phải có lý do rõ ràng.

---

### A1. Ed25519 vs X25519 — Tại sao IK dùng Ed25519?

**Câu hỏi thầy có thể hỏi:** "Tại sao Identity Key dùng Ed25519 trong khi SPK, OPK, EK lại dùng X25519?"

**Câu trả lời:**

```
Ed25519  = thuật toán CHỮ KÝ số (signing), dùng để ký và verify
X25519   = thuật toán TRAO ĐỔI KHÓA (key exchange), dùng để tính DH

IK có 2 nhiệm vụ:
  1. Ký SPK_pub → bắt buộc phải là Ed25519 (chỉ signing key mới ký được)
  2. Tham gia vào DH1, DH2 trong X3DH

→ Giải pháp: IK là Ed25519, khi cần DH thì CONVERT sang X25519:
  IK_priv_x25519 = crypto_sign_ed25519_sk_to_curve25519(IK_secret)
  IK_pub_x25519  = crypto_sign_ed25519_pk_to_curve25519(IK_pub)

Tại sao không dùng 2 key riêng (Ed25519 để ký + X25519 để DH)?
→ Signal spec chọn 1 key duy nhất để đơn giản hóa quản lý và giảm bề mặt tấn công
→ Toán học cho phép: Curve25519 và Ed25519 đều dựa trên cùng 1 đường cong (Twisted Edwards)

Rủi ro của việc dùng cùng 1 key cho 2 mục đích?
→ Đây là câu hỏi khó. Trong lý thuyết, dùng cùng key cho ký và DH có thể có rủi ro
   nhất định (cross-protocol attack). Libsodium và Signal đã phân tích và kết luận
   an toàn với cặp Ed25519/X25519 cụ thể này vì phép convert không reversible.
```

**Trong code:**
```javascript
// x3dh.js:66-67
const IK_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);
```

---

### A2. Tại sao X3DH cần đúng 4 phép DH, không phải 3 hay 5?

**Câu hỏi thầy:** "Bỏ DH4 đi thì sao? DH3 với DH4 khác nhau điểm gì?"

```
DH1 = X25519(IK_A,   SPK_B)  → Alice biết SPK_B là thật (Bob ký bằng IK_B)
DH2 = X25519(EK_A,   IK_B)   → Bob biết EK_A là từ phiên này (không replay được)
      Kết hợp DH1 + DH2 → MUTUAL AUTHENTICATION: cả hai bên xác thực lẫn nhau

DH3 = X25519(EK_A,   SPK_B)  → Forward Secrecy cơ bản
      Lý do: nếu SPK_B bị lộ sau này, SKs của phiên này vẫn an toàn
             vì EK_A đã bị xóa khỏi RAM ngay sau khi gửi tin

DH4 = X25519(EK_A,   OPK_B)  → Perfect Forward Secrecy
      Lý do: OPK_B bị xóa vĩnh viễn sau khi Bob dùng 1 lần
             → Ngay cả Bob cũng KHÔNG THỂ tính lại SK của phiên này
             → Stronger PFS: dù toàn bộ key long-term của Bob bị lộ,
               SK của phiên này vẫn không tính được

Bỏ DH4:  Mất PFS mạnh. Nếu IK_B + SPK_B bị lộ → tính được SK.
Bỏ DH3:  Mất forward secrecy. Nếu EK_A bị lộ + SPK_B bị lộ → tính được SK.
Bỏ DH1:  Mất mutual auth từ phía Alice xác thực Bob.
Bỏ DH2:  Mất mutual auth từ phía Bob xác thực Alice.
```

---

### A3. HKDF — Tại sao không dùng trực tiếp DH1||DH2||DH3||DH4 làm Session Key?

**Câu hỏi thầy:** "Sao không concat 4 kết quả DH lại làm key luôn, cần HKDF làm gì?"

```
Lý do 1 — Entropy không đồng đều:
  Output của DH (X25519) là điểm trên đường cong Curve25519 — không phải uniform random.
  Một số bit có thể có bias nhất định. Dùng trực tiếp làm key AES không an toàn.
  HKDF "làm phẳng" entropy qua HMAC-SHA256 → output gần như uniform random.

Lý do 2 — Key derivation đúng chuẩn:
  AES-GCM yêu cầu key là random bytes chất lượng cao.
  HKDF là KDF (Key Derivation Function) được thiết kế đúng cho mục đích này.

Lý do 3 — Domain separation:
  info = "E2EEChat_v1" → SKs của hệ thống khác dùng cùng IKM sẽ ra key khác.
  Tránh key reuse cross-protocol attack.

Lý do 4 — F = 0xFF × 32:
  Theo Signal spec: thêm 32 byte 0xFF trước IKM để phân biệt X25519 (32B output)
  với X448 (56B output). Không có lý do toán học bắt buộc, đây là convention.
```

**Trong code:**
```javascript
// x3dh.js:24-31
const SK = await crypto.subtle.deriveKey({
  name: 'HKDF',
  hash: 'SHA-256',
  salt: new Uint8Array(32),               // 0x00 × 32 — theo Signal spec
  info: new TextEncoder().encode('E2EEChat_v1'),  // domain separation
}, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
```

---

### A4. PBKDF2 — Tại sao 600.000 iterations?

**Câu hỏi thầy:** "Sao không 100k? Sao không 1 triệu? Con số 600k từ đâu ra?"

```
Nguồn: OWASP Password Storage Cheat Sheet 2023:
  "For PBKDF2-SHA256: minimum 600,000 iterations"

Mục đích: Làm chậm brute-force attack.
  600k iterations ≈ 0.5–1 giây trên browser thường
  → Attacker brute-force 1 triệu mật khẩu: 1M × 0.5s = ~580 ngày chỉ với 1 core

Tại sao không nhiều hơn?
  → UX: > 2 giây người dùng sẽ thấy lag khi đăng nhập
  → OWASP khuyến nghị calibrate theo "0.5–1 giây chấp nhận được"

Tại sao không ít hơn?
  → OWASP minimum là 600k, không nên dùng ít hơn tiêu chuẩn

Con số 600k có được cứng trong code không?
  → Có (keyGen.js:72): iterations: 600_000
  → Thay đổi iterations → không giải mã được key cũ vì wrapping key sẽ ra khác

Thư viện nào cung cấp?
  → Web Crypto API (built-in browser), không phải libsodium
  → Lý do: PBKDF2 là tiêu chuẩn web, Web Crypto API có hardware acceleration
```

---

### A5. AES-256-GCM — Tại sao chọn thuật toán này?

**Câu hỏi thầy:** "Tại sao AES-256 không phải AES-128? GCM là gì? Sao không dùng ChaCha20-Poly1305?"

```
AES vs AES-256:
  AES-128 đủ an toàn về mặt toán học cho đến nay.
  AES-256 dùng vì:
    1. NIST khuyến nghị AES-256 cho "long-term security" (data nhạy cảm nhiều năm)
    2. Khi tính đến quantum computer: AES-128 → bị Grover's algorithm hạ xuống 64-bit
       AES-256 → hạ xuống 128-bit (vẫn an toàn)
    3. Chi phí performance tăng không đáng kể: AES-256 chỉ chậm hơn ~20% so với AES-128

GCM (Galois/Counter Mode):
  AES chỉ là block cipher — mã hóa từng block 128-bit độc lập, không có authentication.
  GCM = CTR mode (confidentiality) + GHASH (authentication tag 128-bit).
  → Authenticated Encryption with Associated Data (AEAD):
    - Mã hóa nội dung (confidentiality)
    - Tính authentication tag để phát hiện tamper (integrity + authenticity)
    - AAD: không mã hóa nhưng được tính vào auth tag
  → Nếu ciphertext bị sửa → auth tag sai → decrypt throw error

Tại sao không ChaCha20-Poly1305?
  → ChaCha20-Poly1305 là lựa chọn tốt tương đương, thường dùng khi không có hardware AES.
  → Browser/CPU hiện đại đều có AES-NI (hardware instruction) → AES-GCM nhanh hơn.
  → Web Crypto API hỗ trợ AES-GCM native; ChaCha20 cần libsodium.
  → Lựa chọn AES-GCM là đúng cho môi trường browser.
```

---

### A6. IV (Initialization Vector) — Tại sao 12 bytes? Tại sao random mỗi tin?

**Câu hỏi thầy:** "Tại sao IV phải 12 bytes cho AES-GCM? 16 bytes không được à?"

```
Lý do kỹ thuật:
  AES-GCM nội bộ tính counter 32-bit từ IV.
  Nếu IV = 12 bytes (96 bits): counter bắt đầu từ 1, tận dụng tối đa 2^32 ≈ 4 tỷ block
  Nếu IV = 16 bytes: phải chạy qua GHASH để derive counter → phức tạp hơn, không thêm security
  → NIST SP 800-38D quy định: IV 96-bit là recommended length cho AES-GCM

Tại sao phải random mỗi tin?
  → CRITICAL: Cùng 1 cặp (Key, IV) mà dùng 2 lần → CATASTROPHIC failure
    Attacker có ciphertext1 và ciphertext2 cùng Key+IV:
    XOR(ciphertext1, ciphertext2) = XOR(plaintext1, plaintext2)
    → Giải mã được nếu biết 1 trong 2 plaintext
    → Thậm chí recover được authentication key
  → Random 12 bytes: xác suất collision = birthday problem với không gian 2^96
    Với 1 tỷ tin nhắn: P(collision) ≈ 10^-10 — chấp nhận được

Tại sao không dùng counter tăng dần?
  → Counter cần được sync giữa các thiết bị/sessions — phức tạp
  → Random đơn giản hơn, đủ an toàn trong thực tế
```

**Trong code:**
```javascript
// aesGcm.js
const IV = crypto.getRandomValues(new Uint8Array(12)); // 96 bits
```

---

### A7. AAD — Tại sao `${conversationId}:${senderId}`?

**Câu hỏi thầy:** "AAD là gì? Bỏ AAD đi có ảnh hưởng gì không?"

```
AAD = Additional Authenticated Data
  → Dữ liệu được đưa vào tính auth tag NHƯNG không được mã hóa
  → Thay đổi AAD → auth tag sai → decrypt fail

Mục đích của `${conversationId}:${senderId}`:
  
  Bảo vệ 1 — Binding sender:
    Không có senderId trong AAD: attacker A và B trong cùng nhóm
    → A gửi tin, B intercept ciphertext → B re-send với senderId=A
    → Receiver giải mã được, nhưng nghĩ A gửi!
    Với senderId trong AAD: B không có SK của A → tính auth tag sai → reject

  Bảo vệ 2 — Binding conversation:
    Không có conversationId: attacker copy ciphertext từ conv 1 sang conv 2
    → Receiver trong conv 2 nếu có cùng SK sẽ đọc được
    Với conversationId: mỗi conversation dùng AAD khác → cross-conversation copy fail

  Tại sao không thêm timestamp?
    → Đồng hồ client và server có thể lệch nhau (NTP drift, timezone)
    → Thêm timestamp làm AAD có thể gây decrypt fail do lệch đồng hồ
    → Đây là quyết định kỹ thuật có ghi trong PROGRESS.md session 7
```

---

### A8. Fingerprint — Tại sao SHA-512 × 5200 lần? Tại sao 60 chữ số?

**Câu hỏi thầy:** "Sao lặp 5200 lần? 100 lần không đủ à? 60 chữ số từ đâu ra?"

```
Tại sao SHA-512 (không phải SHA-256)?
  → SHA-512 output 64 bytes → đủ entropy để tạo 60 chữ số decimal
  → SHA-256 output 32 bytes → 77 chữ số decimal tối đa (hơi giới hạn)

Tại sao lặp 5200 lần?
  → Để làm chậm preimage attack: attacker tính hash trước cho nhiều IK combinations
  → Không có con số "chuẩn" — Signal/WhatsApp dùng cách tương tự
  → 5200 lần SHA-512 ≈ ~300ms trên browser → chấp nhận được UX
  → Quan trọng hơn là: cả hai bên đều dùng cùng số vòng → ra cùng kết quả

Thuật toán:
  combined = sort_canonical(IK_pub_A, IK_pub_B)  // sort để đảm bảo cả 2 bên ra cùng thứ tự
  hash = SHA-512(combined)
  for i in range(5199): hash = SHA-512(hash)
  fingerprint = (BigInt(hex_hash) % 10^60).padStart(60, '0')

Tại sao 60 chữ số?
  → Chia thành 6 nhóm × 10 chữ số → dễ đọc qua điện thoại
  → 60 chữ số = entropy 10^60 ≈ 200 bits → brute-force thực tế là bất khả thi
  → Signal dùng 60 chữ số, đây là convention của ngành

Tại sao phải SORT IK_pub_A và IK_pub_B?
  → Không sort: Alice tính F(IK_A, IK_B), Bob tính F(IK_B, IK_A) → ra khác nhau
  → Sort canonical: cả hai bên sẽ tính cùng thứ tự → ra cùng fingerprint

Tại sao kênh ngoài (điện thoại)?
  → Nếu so sánh qua chat: server là MITM, có thể thay 60 số giả của attacker
  → Kênh ngoài không thể bị MITM của server (voice/video/gặp trực tiếp)
```

---

<a name="chu-de-b"></a>
## 3. Chủ Đề B — Backend & Database

---

### B1. bcrypt cost 12 — Tại sao không 10 hay 14?

```
bcrypt cost factor = số vòng = 2^cost lần hash
  cost 10 = 2^10 = 1024 vòng ≈ 50ms  (OWASP tối thiểu cũ, 2017)
  cost 12 = 2^12 = 4096 vòng ≈ 250ms (OWASP 2023 khuyến nghị)
  cost 14 = 2^14 = 16384 vòng ≈ 1s   (quá chậm cho login endpoint)

Lý do chọn cost 12:
  1. OWASP 2023: khuyến nghị cost ≥ 10, cost 12 là "best practice current"
  2. Trade-off: 250ms trên server là chấp nhận được với người dùng
  3. Server Node.js: bcrypt chạy trên UV thread pool (CPU-bound)
     cost 14 × nhiều user đồng thời → bottleneck thread pool

Lý do không dùng Argon2id (tốt hơn bcrypt)?
  → Ban đầu dùng Argon2id, đổi sang bcrypt cost 12 theo đề xuất của thầy (PROGRESS.md session 7)
  → Lý do thầy: "Đơn giản hơn, dễ giải thích hơn"
  → Về bảo mật: bcrypt cost 12 vẫn đủ mạnh cho scope dự án nội bộ
  → Argon2id tốt hơn vì memory-hard (chống ASIC/GPU attack) — nhưng phức tạp hơn khi giải thích
```

---

### B2. JWT — Tại sao 7 ngày? Tại sao lưu Redis blocklist?

```
JWT 7 ngày:
  → Stateless: server không lưu session — tốt cho scale
  → Trade-off: token bị lộ → attacker dùng được 7 ngày
  → Giảm thiểu: logout → revoke token vào Redis blocklist ngay lập tức

Redis blocklist:
  Vấn đề cơ bản của JWT: stateless → không có cách nào "hủy" token đang còn hiệu lực.
  → Giải pháp: blocklist = Redis SET, key = "blocklist:{token}", TTL = thời gian còn lại của JWT.
  → Mỗi request: middleware verify JWT → check Redis → nếu có trong blocklist → 401.
  
  Tại sao Redis (không phải PostgreSQL)?
  → Redis là in-memory → check key O(1) rất nhanh (~0.1ms)
  → Mỗi API request đều phải check blocklist → phải cực nhanh
  → PostgreSQL check ~5ms → nhân với hàng nghìn request/giây → bottleneck
  → TTL built-in: Redis tự xóa key khi hết hạn — không cần cron job

  Tại sao không lưu session trong DB thay vì dùng JWT + blocklist?
  → Session DB: mỗi request = 1 DB query → không scale tốt
  → JWT + Redis: JWT verify ở memory (fast), Redis check ~0.1ms → tổng ~1ms
```

---

### B3. Cursor Pagination — Tại sao không dùng offset pagination?

**Câu hỏi thầy:** "OFFSET 0 LIMIT 20 có gì sai?"

```
Offset pagination: SELECT * FROM messages ORDER BY createdAt DESC OFFSET 100 LIMIT 20
  Vấn đề 1 — Performance:
    DB phải scan và bỏ qua 100 records trước khi trả về 20.
    Với 1 triệu tin nhắn: OFFSET 999980 → scan gần như toàn bộ bảng.
    O(N) với N là tổng số tin.

  Vấn đề 2 — Consistency:
    Alice load page 1 (tin 1-20).
    Trong lúc đó Bob gửi 1 tin mới → tin cũ trở thành tin 2-21.
    Alice load page 2 (OFFSET 20) → thấy lại tin 20 từ page 1!
    → Duplicate records khi có insert trong lúc phân trang.

Cursor pagination: dùng createdAt của record cuối cùng làm cursor
  SELECT * FROM messages WHERE conversationId=X AND createdAt < {cursor} 
  ORDER BY createdAt DESC LIMIT 20

  Ưu điểm 1 — Performance:
    Index trên (conversationId, createdAt DESC) → O(log N) → cực nhanh
    Không bao giờ scan record đã qua

  Ưu điểm 2 — Consistency:
    Tin mới thêm vào không ảnh hưởng đến cursor hiện tại
    → Không bao giờ bị duplicate hay bỏ sót

Giải thích index trong schema.prisma:
  @@index([conversationId, createdAt(sort: Desc)])
  → Compound index: tìm theo conversationId xong sort theo createdAt ngay trong index
  → Không cần full scan bảng
```

---

### B4. `prisma.$transaction` — Khi nào dùng và tại sao?

```
Dự án dùng $transaction ở 3 chỗ:

Chỗ 1 — Đăng ký (auth.js):
  prisma.$transaction([
    prisma.user.create(...),
    prisma.allowedEmail.update({ usedAt: now })
  ])
  → Nếu user.create thành công nhưng allowedEmail.update fail:
    user tồn tại nhưng email vẫn "chưa dùng" → đăng ký lại sẽ tạo duplicate user
  → Transaction: cả 2 thành công cùng lúc, hoặc cả 2 rollback

Chỗ 2 — Verify fingerprint 1-1 (conversations.js):
  prisma.$transaction([
    prisma.conversation.update({ fingerprintVerified: true }),
    prisma.peerVerification.upsert(...)
  ])
  → Đảm bảo verify 1-1 đồng bộ với PeerVerification global
  → Không có trạng thái "đã verify ở 1-1 nhưng chưa trong PeerVerification"

Chỗ 3 — Thu hồi quyền admin (admin.js):
  prisma.$queryRaw`SELECT COUNT(*) FROM "User" WHERE role='ADMIN' FOR UPDATE`
  prisma.$transaction(...)
  → FOR UPDATE: row-level lock trong PostgreSQL
  → Race condition: 2 admin A và B cùng revoke quyền admin của nhau đồng thời:
    - A đọc count = 2 → ok → revoke B
    - B đọc count = 2 → ok → revoke A
    → Kết quả: 0 admin còn lại!
  → FOR UPDATE: request thứ 2 phải chờ lock → thứ 1 commit → thứ 2 đọc lại count = 1 → bị từ chối
```

---

### B5. WebSocket — Tại sao lưu DB trước, relay sau?

```
2 cách tiếp cận:
  Cách A (relay trước): relay WS → INSERT DB
    Rủi ro: relay thành công nhưng server crash trước khi INSERT
    → Bob nhận tin nhưng reload thì tin biến mất (tin không tồn tại trong DB)

  Cách B (INSERT trước): INSERT DB → relay WS  ← dự án dùng
    Rủi ro: INSERT thành công nhưng server crash trước khi relay
    → Bob không nhận tin real-time, nhưng reload thì thấy tin (vì đã lưu DB)

→ Cách B an toàn hơn về mặt "không mất tin nhắn"
→ Chi phí: thêm ~5-15ms (thời gian DB write) trước khi Bob nhận tin
→ Trong context chat: độ trễ 5-15ms là không đáng kể với người dùng

Thuật ngữ kỹ thuật: "write-ahead log" pattern — persist trước, publish sau.
```

---

### B6. `UV_THREADPOOL_SIZE=8` — Tại sao?

```
Node.js single-threaded nhưng có Thread Pool (libuv) cho tác vụ blocking I/O + CPU.

Mặc định: UV_THREADPOOL_SIZE = 4
bcrypt.hash() chạy trên thread pool (CPU-bound, blocking)

Vấn đề: 5 users đồng thời login → 5 bcrypt hash cùng lúc
  → Thread 1,2,3,4 đang chạy bcrypt
  → Thread 5 phải chờ → login request 5 bị block

Giải pháp: tăng pool = số core CPU
  → Server deploy có 8 core → UV_THREADPOOL_SIZE=8

Tại sao không đặt = 16 hay 32?
  → Thread pool lớn hơn số core CPU = context switching overhead vô ích
  → Rule of thumb: pool size ≈ số CPU core

Cần phân biệt:
  UV Thread Pool: xử lý CPU-bound (bcrypt, crypto)
  Connection Pool (Prisma): quản lý TCP connections đến PostgreSQL
  → Hai thứ này HOÀN TOÀN độc lập nhau
```

---

<a name="chu-de-c"></a>
## 4. Chủ Đề C — Frontend & Key Management

---

### C1. Tại sao private key lưu IndexedDB, không phải localStorage?

**Câu hỏi thầy:** "Cả 2 đều ở browser, khác nhau gì?"

```
localStorage:
  - Key-value store, chỉ lưu string
  - Đồng bộ (blocking) — đọc/ghi block main thread
  - Dung lượng: 5-10MB
  - Truy cập được từ mọi script trong cùng origin

IndexedDB (Dexie.js):
  - Database structured, lưu được Uint8Array, objects, blobs
  - Bất đồng bộ (non-blocking) — đọc/ghi không block UI
  - Dung lượng: hàng GB (nếu người dùng cho phép)
  - Truy cập được từ mọi script trong cùng origin (bảo mật như nhau về mặt origin)

Lý do chọn IndexedDB:
  1. Private key là Uint8Array (binary data) — localStorage không lưu binary tốt
     (phải convert sang base64 → thêm overhead, mất type safety)
  2. 100 OPK keys × 32 bytes × wrap overhead → có thể vài KB → không vấn đề với IndexedDB
  3. Bất đồng bộ: không block UI trong quá trình wrap/unwrap
  4. Dexie.js: thư viện wrapper cho IndexedDB dễ dùng hơn raw IndexedDB API

Private key có an toàn trong IndexedDB không?
  → IndexedDB không được mã hóa tự động bởi browser (trừ Safari).
  → Giải pháp: tất cả private key được WRAP bằng AES-GCM(wrappingKey) trước khi lưu.
  → Ai đọc được IndexedDB vẫn thấy ciphertext — không giải mã được vì không có wrappingKey.
  → wrappingKey chỉ sống trong RAM — không lưu ở đâu cả.
  → Kẻ tấn công cần CẢ HAI: IndexedDB data + wrappingKey (chỉ trong RAM khi đăng nhập).
```

---

### C2. Tại sao token lưu localStorage thay vì httpOnly cookie hay RAM?

```
3 lựa chọn:

Lựa chọn 1 — RAM (React state):
  Ưu điểm: XSS không đọc được (React state không expose ra window)
  Nhược điểm: Reload trang → mất token → phải login lại
  → Không phù hợp: sau reload cần biết user đã đăng nhập để hiện UnlockModal

Lựa chọn 2 — httpOnly cookie:
  Ưu điểm: JS không đọc được → XSS không thể đánh cắp token
  Nhược điểm 1: CORS phức tạp với SPA + separate API server
  Nhược điểm 2: Cần backend set cookie, SameSite/Secure flag phức tạp
  Nhược điểm 3: CSRF attack mới phải chống (thêm CSRF token)
  → Scope đồ án: quá phức tạp, không đủ giá trị

Lựa chọn 3 — localStorage  ← dự án dùng:
  Ưu điểm: Đơn giản, persist qua reload, dễ implement
  Nhược điểm: XSS đọc được token
  Giảm thiểu rủi ro:
    1. CSP (Content Security Policy): hạn chế script inject
    2. Private key KHÔNG lưu localStorage — lưu IndexedDB đã mã hóa
    3. Token bị lộ: attacker chỉ làm được những gì user làm được — không đọc được plaintext
       (plaintext cần wrappingKey, wrappingKey chỉ trong RAM)

Kết luận:
  → Với E2EE model, token bị lộ ít nguy hiểm hơn so với app thường
    vì server không có plaintext dù attacker có token
  → Trade-off có chủ ý: UX (UnlockModal) > XSS risk trên token
```

---

### C3. Vòng đời của wrappingKey — Tại sao quan trọng?

```
wrappingKey = PBKDF2(password, wrapSalt) — AES-256-GCM CryptoKey

Vòng đời:
  Sinh ra:  Login / Register / Unlock — sau khi user nhập đúng password
  Sống ở:   RAM (AuthContext state: wrappingKey = useState(null))
  Chết khi: 
    - Logout: setWrappingKey(null)
    - Reload/close tab: React state bị clear

Tại sao KHÔNG lưu wrappingKey vào localStorage/IndexedDB?
  → wrappingKey = AES key để decrypt private keys
  → Lưu xuống disk = "để chìa khóa ngay cạnh két sắt"
  → Ai đọc được wrappingKey → đọc được private key → đọc được mọi tin nhắn
  → Private key + session key + mọi thứ mất hết

Hệ quả của thiết kế này:
  → Reload → wrappingKey = null → app ở trạng thái "locked"
  → isLocked = (token != null) && (wrappingKey == null)
  → App hiện UnlockModal → user nhập password lại → derive wrappingKey lại từ IndexedDB salt
  → Đây là đúng về bảo mật: attacker lấy được thiết bị khi màn hình tắt
    → không có wrappingKey trong RAM → không đọc được gì

Câu hỏi hay của thầy: "Sau reload, app có cần gọi server không?"
  → KHÔNG. Unlock hoàn toàn local:
    1. getWrapSalt(userId) từ IndexedDB → không cần server
    2. deriveWrappingKey(password, salt) → tính toán local
    3. loadPrivateKeys → đọc IndexedDB + decrypt local
    4. Set RAM state → done
```

---

### C4. Tại sao OPK_priv dùng `getOPK()` thay vì load tất cả?

```
Trong X3DH receiver (khi Bob nhận tin đầu tiên):
  Bob cần OPK_priv tương ứng với opkId Alice gửi.
  
Cách 1 (không dùng): loadPrivateKeys() → unwrap TẤT CẢ 100 OPK
  → 100 lần AES-GCM decrypt × ~0.1ms = ~10ms overhead
  → Thừa: chỉ cần 1 trong 100 OPK

Cách 2 (dùng): getOPK(userId, opkId, wrappingKey) → chỉ unwrap 1 OPK theo ID
  → 1 lần AES-GCM decrypt = ~0.1ms
  → ~100x nhanh hơn

Điều kiện tiên quyết: IK_secret và SPK_priv đã có trong RAM (AuthContext)
  → không cần load lại từ IndexedDB
  → chỉ thiếu OPK_priv (vì có 100 cái, không load hết lên RAM)
```

---

### C5. `.fill(0)` — Tại sao xóa DH values bằng fill(0) thay vì gán null?

```
JavaScript garbage collector không đảm bảo KỊCH BẢN nào bộ nhớ bị xóa/ghi đè.
  Nếu gán = null: GC có thể đánh dấu để collect, nhưng bytes 0x??
  trong RAM vẫn là DH value cho đến khi GC chạy + memory được reuse.

.fill(0): Ghi đè 0x00 lên TẤT CẢ bytes của Uint8Array ngay lập tức, không cần đợi GC.

Tại sao quan trọng?
  Cold boot attack / memory dump:
    Attacker có thể dump RAM (cold boot attack, VM snapshot, core dump)
    → Nếu DH1-4 và EK_priv còn trong RAM → tính lại được SK
    → .fill(0) đảm bảo bytes đó là 0, không còn là DH value

Giới hạn:
  JavaScript là high-level language — JS engine có thể tối ưu/cache giá trị.
  .fill(0) là best-effort trong môi trường JS (không có memory-safe guarantee như Rust/C).
  Tuy nhiên, đây vẫn là best practice và giảm đáng kể attack window.

Trong code:
  // x3dh.js:84-86
  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);
  EK.privateKey.fill(0);
```

---

<a name="chu-de-d"></a>
## 5. Chủ Đề D — Kiến Trúc & Quyết Định Thiết Kế

---

### D1. Blind Server Model — Giải thích đầy đủ

```
Định nghĩa: Server KHÔNG BAO GIỜ có khả năng đọc plaintext tin nhắn.

Điều server biết:
  - Ai nhắn tin với ai (conversationId, senderId)
  - Khi nào (createdAt)
  - Ciphertext (bytes vô nghĩa nếu không có SK)
  - Public keys (IK_pub, SPK_pub — chỉ public, không có private)

Điều server KHÔNG biết:
  - Nội dung tin nhắn
  - Session Key (SK) dùng để mã hóa
  - Private keys của bất kỳ user nào

Tại sao đảm bảo được điều này?
  → Private key sinh tại browser, wrap ngay bằng wrappingKey → lưu IndexedDB
  → wrappingKey = PBKDF2(password) → tính tại browser, không bao giờ gửi lên server
  → SK = X3DH output → tính tại browser từ private keys, không bao giờ gửi lên server
  → Server chỉ nhận: ciphertext, IV, AAD, EK_pub, OPK_id — không đủ để decrypt

Tình huống server bị hack:
  Attacker lấy được: toàn bộ DB (ciphertext, public keys, metadata)
  Attacker KHÔNG lấy được: private keys, wrapping keys, session keys
  → Ciphertext trong DB là vô dụng với attacker (không có SK để decrypt)

So sánh với hệ thống chat thông thường:
  Chat thường (Telegram chế độ không bật Secret Chat):
    Server có private key → server có thể decrypt mọi tin nhắn
    Server bị hack → toàn bộ tin nhắn bị lộ
  E2EE Chat (dự án này):
    Server không có private key → server không thể decrypt
    Server bị hack → chỉ mất metadata (ai chat với ai, khi nào)
```

---

### D2. Single-device limitation — Giải thích và đề xuất cải tiến

```
Nguyên nhân:
  Private key lưu IndexedDB của thiết bị đăng ký.
  IndexedDB không sync giữa các thiết bị (by design — để bảo mật).
  → Laptop A: có IndexedDB với private key → đăng nhập được
  → Điện thoại B: IndexedDB trống → DEVICE_NOT_REGISTERED

Giải pháp trong scope (đã implement):
  Export/Import thủ công qua file .e2ee
  → File .e2ee chứa wrapped private keys (đã mã hóa bằng wrappingKey)
  → Muốn dùng thiết bị B: copy file sang, import, nhập password → unwrap OK

Giải pháp ngoài scope (Signal Sesame Protocol):
  → Multi-device sync: server lưu "device bundle" cho mỗi thiết bị
  → Khi đăng nhập thiết bị mới: thiết bị cũ "deliver" session keys qua X3DH
  → Rất phức tạp: cần quản lý device list, revoke device, sync session state
  → Nằm ngoài scope đồ án — nhưng cần biết để trả lời thầy

Câu hỏi hay của thầy: "Nếu người dùng mất điện thoại thì sao?"
  → Không có file .e2ee backup → mất key → không giải mã được lịch sử
  → Đây là trade-off của E2EE: bảo mật cao → bất tiện hơn khi mất thiết bị
  → Giải pháp partial: khuyến khích export backup định kỳ
  → Key takeaway: "security vs convenience trade-off — chúng tôi chọn security"
```

---

### D3. Group chat "N tin 1-1 song song" — Tại sao không dùng Sender Keys?

```
Sender Keys (Signal Group):
  1 key chung cho cả nhóm, mỗi thành viên có 1 bản được mã hóa riêng để nhận key
  → 1 bản ciphertext duy nhất cho mỗi tin nhắn dù nhóm có N người
  → Hiệu quả hơn: O(1) ciphertext per message

N tin 1-1 song song (dự án này):
  Mỗi tin nhắn = N bản ciphertext, mỗi bản mã hóa bằng SK riêng với từng thành viên
  → O(N) ciphertext per message

Tại sao không dùng Sender Keys?
  1. Complexity: Sender Keys cần quản lý "ratchet state" cho nhóm
     → Khi member join/leave: cần "sender key delivery" phase phức tạp
     → Nằm ngoài scope đồ án
  2. Scope đồ án: dự kiến nhóm nhỏ (< 20 người) trong nội bộ công ty
     → N × tin nhắn vẫn chấp nhận được với bandwidth hiện đại
  3. Simplicity: tái dùng cơ chế 1-1 đã implement → ít code, ít bug

Hạn chế phải thừa nhận:
  → Nhóm 50 người: mỗi tin = 50 bản ciphertext → không scale tốt
  → Giải pháp thực tế: Signal dùng Sender Keys, MLS cho nhóm lớn
  → Phù hợp với mục tiêu: "hệ thống nội bộ doanh nghiệp nhỏ"
```

---

### D4. PeerVerification global — Tại sao verify 1 lần xanh ở tất cả nhóm?

```
Bài toán:
  Alice trong nhóm A, B, C — cùng có Bob.
  Không có PeerVerification global:
    Alice phải verify Bob 3 lần (1 lần ở mỗi nhóm) → UX tệ

Insight kỹ thuật:
  Fingerprint = SHA-512^5200(IK_pub_A, IK_pub_B)
  IK (Identity Key) là VĨNH VIỄN — không đổi theo nhóm hay conversation.
  → Fingerprint không phụ thuộc context (nhóm nào, conversation nào)
  → Verify Bob 1 lần = verify IK_pub_B của Bob là thật
  → Kết quả valid ở mọi context có Bob

Thiết kế DB:
  PeerVerification { verifierId, peerId } — không có groupId hay conversationId
  → Global record: Alice đã verify Bob (không gắn với group cụ thể)

Đồng bộ 1-1 ↔ group:
  PATCH /conversations/:convId/fingerprint:
    → cập nhật Conversation.fingerprintVerified = true
    → ĐỒNG THỜI tạo PeerVerification record (trong $transaction)
  → Verify 1-1 tự động sync sang group và ngược lại

Script backfill:
  Dữ liệu verify 1-1 cũ (trước khi có PeerVerification table) → backfill 2 chiều A→B và B→A
```

---

<a name="cau-hoi"></a>
## 6. Bộ Câu Hỏi Thầy Thường Hỏi + Đáp Án Mẫu

> Ghi nhớ: trả lời đúng → thầy sẽ hỏi sâu hơn. Chuẩn bị cả follow-up question.

---

### Nhóm câu hỏi Crypto

**Q: "Em giải thích X3DH cho tôi nghe đi. Tại sao cần 4 phép DH?"**
> Mỗi phép DH đóng 1 vai trò: DH1+DH2 = mutual authentication, DH3 = forward secrecy, DH4 = perfect forward secrecy nhờ OPK dùng 1 lần. Thiếu bất kỳ phép nào đều làm mất đi 1 tính chất bảo mật cụ thể.

**Q: "Forward Secrecy là gì? Dự án em có Forward Secrecy không?"**
> Có. Forward Secrecy đảm bảo dù private key long-term bị lộ sau này, tin nhắn quá khứ vẫn không giải mã được. Dự án đảm bảo điều này vì EK_priv bị xóa (.fill(0)) ngay sau X3DH, OPK_priv bị xóa sau khi Bob dùng — không ai có thể tính lại SK dù có IK và SPK.

**Q: "PBKDF2 600k iterations bảo vệ cái gì?"**
> Bảo vệ wrappingKey (khóa mã hóa private key) khỏi brute-force attack. Nếu attacker lấy được IndexedDB, họ cần brute-force password để derive wrappingKey mới decrypt được private key. 600k iterations ≈ 0.5s/attempt — 1 triệu mật khẩu cần ~580 ngày với 1 core.

**Q: "AES-GCM authentication tag bảo vệ cái gì?"**
> Bảo vệ tính toàn vẹn và xác thực nguồn gốc của ciphertext. Nếu attacker sửa 1 bit ciphertext hay thay AAD → authentication tag sai → decrypt throw error → receiver biết tin bị tamper. Khác với AES-CBC chỉ có confidentiality, không có integrity.

**Q: "Tại sao IK cần Ed25519 nhưng DH dùng X25519?"**
> Ed25519 là signing algorithm (ký/verify), X25519 là key exchange algorithm (DH). IK cần ký SPK → bắt buộc phải là Ed25519. Khi IK tham gia X3DH DH1/DH2, ta convert sang X25519 bằng hàm `crypto_sign_ed25519_sk_to_curve25519` của libsodium — điều này an toàn vì cả hai đều dựa trên Curve25519.

---

### Nhóm câu hỏi Backend

**Q: "Tại sao logout phải gọi server? JWT không phải stateless sao?"**
> JWT stateless không có cơ chế "hủy" token. Nếu chỉ xóa localStorage, attacker có token bị đánh cắp vẫn dùng được. Giải pháp: logout gửi token lên server → server cho vào Redis blocklist → mọi request sau đó với token này đều bị từ chối. TTL của Redis key = thời gian còn lại của JWT → tự dọn dẹp.

**Q: "Sao không xóa IndexedDB khi logout?"**
> Không xóa IndexedDB là thiết kế có chủ ý. Wrapped private key (đã mã hóa bằng wrappingKey) vẫn lưu để lần đăng nhập sau không cần re-generate key mới. Nếu xóa: người dùng phải đăng ký lại, upload key bundle mới → conversation cũ với SK cũ sẽ không giải mã được.

**Q: "Cursor pagination dùng cột gì? Tại sao không dùng ID?"**
> Dùng `createdAt` vì đây là trường được sort và có index compound `(conversationId, createdAt DESC)`. Dùng ID (UUID) cũng được nhưng UUID không có thứ tự thời gian tự nhiên — sort theo thời gian mà dùng UUID làm cursor cần thêm join hoặc subquery. Timestamp đơn giản hơn và đã có sẵn index phù hợp.

**Q: "IDOR là gì? Dự án em chống IDOR ở đâu?"**
> IDOR = Insecure Direct Object Reference. Attacker đoán/thay ID để truy cập resource của người khác. Dự án chống ở: (1) WS handler: membership check trước khi relay — không phải member không relay, (2) messages.js: check conversationId thuộc về senderId trước khi lưu, (3) GET /messages/:convId: check user là participant trước khi trả history.

---

### Nhóm câu hỏi Frontend

**Q: "Private key sẵn sàng trong RAM có nghĩa gì? Rủi ro gì?"**
> Sau login, IK_secret, SPK_priv, wrappingKey sống trong React state (heap memory). Rủi ro: XSS inject script đọc React state → có thể lấy được key. Giảm thiểu: CSP header ngăn inject script từ ngoài, private key không lưu localStorage (chỉ RAM), logout xóa state ngay.

**Q: "Tại sao sessionKeysRef dùng useRef thay vì useState?"**
> useState re-render component khi thay đổi. Session key cache cần update thường xuyên (mỗi khi có tin nhắn mới/X3DH) mà không cần trigger re-render. useRef = mutable container, persist qua renders, không gây re-render. Cũng giải quyết stale closure: callback đăng ký 1 lần luôn đọc được giá trị Map mới nhất.

**Q: "UnlockModal block UI như thế nào?"**
> ProtectedRoute check `isLocked`: nếu true → render `<UnlockModal />` thay vì `<Outlet />` (router content). UnlockModal không có nút đóng, không có cách bypass qua URL. Người dùng bắt buộc phải nhập đúng password mới dismiss. Unlock() local: không gọi server, chỉ PBKDF2 + IndexedDB decrypt.

---

### Nhóm câu hỏi Architecture

**Q: "Nếu scale hệ thống lên 10 server thì WebSocket relay có còn hoạt động không?"**
> Không. clients Map là in-memory của 1 Node.js process. Server A và B có Map riêng. Alice kết nối A, Bob kết nối B → A không biết Bob đang ở B → relay fail. Giải pháp: Redis Pub/Sub — mỗi server subscribe channel "user:{userId}", khi cần relay publish lên channel đó. Đây là known limitation đã ghi trong báo cáo.

**Q: "Tại sao không block group chat khi chưa verify fingerprint?"**
> 3 lý do: (1) Group hiếm khi block được: thành viên mới join sẽ chưa verify ai → block hết là không dùng được. (2) Signal cũng không block (Safety Numbers tự nguyện). (3) E2EE đã bảo vệ 99% mối đe dọa (nghe lén, DB leak) dù không verify. Fingerprint chỉ chống MITM chủ động của server — rủi ro rất thấp với hệ thống nội bộ tự vận hành.

**Q: "ADMIN_SEED_EMAIL hoạt động như thế nào? Race condition không?"**
> Email đặc biệt trong .env, khi đăng ký với email này: bypass whitelist check + tự động gán role=ADMIN. Chỉ có tác dụng 1 lần — sau khi đăng ký thành công, email đó tồn tại trong bảng User với `@unique` → lần đăng ký tiếp theo sẽ trả 409. Không race condition vì prisma.$transaction đảm bảo atomic.

---

<a name="meeting"></a>
## 7. Checklist Chuẩn Bị Meeting Hàng Tuần

> In ra, dùng mỗi buổi trước khi gặp thầy.

### 1 ngày trước meeting

```
□ Đọc lại code của phần sẽ báo cáo — không đọc từ tài liệu, đọc từ FILE THỰC TẾ
□ Chạy lại demo — đảm bảo tất cả flow hoạt động không lỗi
□ Chuẩn bị 1 tờ giấy tay (không dùng máy): tóm tắt điểm chính muốn trình bày
□ Liệt kê 3-5 câu hỏi thầy CÓ THỂ hỏi về phần này
□ Tự trả lời từng câu — nếu không trả lời được → đọc lại code/tài liệu
```

### Ngay trước khi vào phòng thầy

```
□ Biết được số version hiện tại (Node.js, bcrypt, Prisma, libsodium)
□ Nhớ ít nhất 1 con số cụ thể của mỗi tham số (PBKDF2: 600k, bcrypt: 12, IV: 12 bytes, fingerprint: 60 chữ số × 5200 vòng)
□ Chuẩn bị ít nhất 1 "rủi ro nếu thay đổi" cho mỗi tham số quan trọng
□ Biết file nào chứa code nào (không phải nhớ thuộc lòng, nhưng phải biết mở ra ngay)
```

### Cấu trúc báo cáo 15 phút

```
3 phút — Tổng quan tuần này làm gì (hoàn thành gì, gặp vấn đề gì)
7 phút — Demo live (thầy thích thấy code chạy hơn là slide)
5 phút — Deep dive vào 1 quyết định kỹ thuật quan trọng (tự chọn cái thầy chưa hỏi)
```

### Khi thầy challenge

```
Câu hỏi không biết: "Dạ, em chưa tìm hiểu kỹ phần này, em sẽ trả lời tuần sau ạ."
  → KHÔNG cố đoán mò — thầy sẽ phát hiện ngay
  → Ghi vào notebook ngay lúc đó, tuần sau nhớ trả lời trước

Câu hỏi biết một phần: Nói phần mình biết, thừa nhận phần không chắc.
  → "Em hiểu phần A như thế này, nhưng phần B em cần xem lại ạ."

Câu hỏi về trade-off: Luôn có cả 2 mặt — đây là loại câu hỏi thầy thích nhất.
  → "Giải pháp này có ưu điểm X, nhược điểm Y. Em chọn vì Z."
```

---

<a name="xu-ly"></a>
## 8. Cách Xử Lý Khi Bị Hỏi Bất Ngờ

### Framework trả lời cho bất kỳ tham số nào

Khi thầy hỏi "Tại sao [CON SỐ] này?", dùng template:

```
"Dạ con số [X] này được chọn vì:

1. Nguồn chuẩn: [OWASP / NIST / Signal spec / RFC]
   → Họ khuyến nghị [Y] vì [lý do kỹ thuật]

2. Trade-off:
   Nếu dùng ít hơn: [rủi ro bảo mật cụ thể]
   Nếu dùng nhiều hơn: [chi phí performance / UX]

3. Trong context dự án này:
   [lý do cụ thể phù hợp với use case nội bộ doanh nghiệp]"
```

**Ví dụ áp dụng cho PBKDF2 600k:**
> "Dạ con số 600.000 iterations này được chọn vì OWASP Password Storage Cheat Sheet 2023 khuyến nghị minimum 600.000 iterations cho PBKDF2-SHA256. Nếu dùng ít hơn, chẳng hạn 100.000, attacker brute-force nhanh hơn 6 lần. Nếu dùng nhiều hơn, chẳng hạn 2.000.000, người dùng sẽ cảm thấy login chậm hơn 3 giây — ảnh hưởng UX. Với 600.000, thời gian khoảng 0.5 giây — đúng như OWASP hướng dẫn calibrate cho UX chấp nhận được."

---

### Các câu hỏi "bẫy" hay gặp

**"Dự án em bảo mật 100% không?"**
> Không có hệ thống nào bảo mật 100%. Dự án bảo vệ tốt khỏi: nghe lén mạng, rò rỉ DB, server bị hack. Chưa bảo vệ được: thiết bị bị chiếm toàn bộ (ai cầm điện thoại đang mở app thì đọc được), XSS inject vào page. Đây là known limitation và là trade-off có chủ ý.

**"Nếu server bị hack thì sao?"**
> Attacker lấy được: ciphertext (vô dụng không có SK), public keys (không giải mã được), metadata (ai chat với ai, khi nào). Không lấy được: private keys (chưa bao giờ lên server), session keys (tính tại browser, không lưu server). → Server bị hack = mất metadata, không mất nội dung tin nhắn.

**"Tại sao không dùng thư viện có sẵn như Signal's SDK?"**
> Signal SDK không có bản public dùng được cho web browser. Dự án dùng libsodium-wrappers (wrapper của libsodium — thư viện crypto được audit kỹ) và Web Crypto API (built-in browser, hardware-accelerated). Đây là lựa chọn đúng cho môi trường web.

**"Dự án em scale được không?"**
> Với thiết kế hiện tại: 1 server instance, WebSocket in-memory Map. Không scale ngang. Đây là known limitation đã ghi trong báo cáo. Giải pháp: Redis Pub/Sub cho WebSocket. Về crypto layer: hoàn toàn stateless ở server — mỗi server instance xử lý được vì không cần shared state về session keys.

---

## Tài Liệu Tham Khảo Cần Biết

Khi thầy hỏi "Đọc nguồn nào?", phải có câu trả lời:

| Chủ đề | Tài liệu | URL |
|--------|----------|-----|
| X3DH spec | Signal: "The X3DH Key Agreement Protocol" | signal.org/docs/specifications/x3dh |
| AES-GCM | NIST SP 800-38D | nvlpubs.nist.gov/nistpubs/Legacy/SP/... |
| PBKDF2 | OWASP Password Storage Cheat Sheet | cheatsheetseries.owasp.org |
| PBKDF2 iterations | NIST SP 800-132 | nvlpubs.nist.gov |
| JWT | RFC 7519 | datatracker.ietf.org/doc/html/rfc7519 |
| bcrypt | Original paper: "A Future-Adaptable Password Scheme" (Provos & Mazières 1999) | usenix.org |
| Fingerprint | Signal Safety Numbers spec | signal.org/docs/specifications/... |

---

*Tài liệu này được soạn dựa trên code thực tế trong dự án (session 1–27). Mỗi câu hỏi có thể trace về file cụ thể.*
