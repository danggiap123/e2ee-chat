# Chuẩn bị phản biện — E2EE Chat
> Cập nhật: 17/06/2026 | Dựa trên kịch bản phản biện Gemini + toàn bộ source code

---

## PHẦN 1: CÂU HỎI VỀ MẬT MÃ HỌC (Cryptography)

---

### Q1. "Server phân phối public key — nếu server bị hack thì sao, MITM attack tấn công được không?"

**Trả lời:**

Đây là điểm GV sẽ chắc chắn hỏi. Câu trả lời ngắn: **CÓ thể xảy ra MITM, nhưng hệ thống có cơ chế phát hiện.**

**Kịch bản tấn công:**
1. Server bị compromise
2. Hacker thay `ikPub` của Bob trong DB bằng public key của mình
3. Alice fetch key → nhận key giả → X3DH với hacker, tưởng đang chat với Bob

**Tại sao hệ thống phát hiện được:**
- Mỗi SPK được **Bob ký bằng IK_secret (Ed25519)** trước khi upload
- Khi Alice fetch bundle → `performX3DH_sender()` gọi `verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B)`
- Nếu hacker thay cả `ikPub` lẫn `spkPub` → chữ ký sai → hàm này throw `'SPK signature invalid — possible MITM attack'` → dừng ngay
- Nếu hacker chỉ thay `ikPub` → tính `IK_pub_B_x` khác → DH1, DH2 khác → SK khác → Alice giải mã được nhưng Bob không giải mã được → tin nhắn fail

**Lớp bảo vệ thứ 2 — Fingerprint:**
- Fingerprint = SHA-512 × 5200 lần trên `concat(sort([IK_pub_A, IK_pub_B]))` → 60 chữ số
- Alice và Bob gọi điện/gặp nhau → đọc to 60 số → nếu khớp → IK_pub đang dùng là thật
- Nếu hacker đã thay key → fingerprint khác → phát hiện ngay
- Trong hệ thống nội bộ doanh nghiệp, người dùng biết nhau → verify dễ hơn Signal

**Kết luận:** Mô hình Blind Server + Ed25519 signature + Fingerprint = 3 lớp bảo vệ. Không có backdoor, không có CA tập trung.

---

### Q2. "Perfect Forward Secrecy (PFS) là gì? Hệ thống của bạn có PFS không?"

**Trả lời:**

**PFS định nghĩa:** Nếu private key của người dùng bị lộ hôm nay, kẻ tấn công **không thể giải mã các tin nhắn đã gửi trong quá khứ**.

**Hệ thống này có PFS ở mức nào:**

**Có PFS cho tin nhắn đầu tiên (X3DH):**
- Alice sinh `EK` (Ephemeral Key) — dùng 1 lần duy nhất cho lần session này
- DH3 = `EK_priv × SPK_pub_B` và DH4 = `EK_priv × OPK_pub_B` → tạo ra `SK`
- Sau khi tính xong: `EK.privateKey.fill(0)` → xóa khỏi RAM ngay
- OPK của Bob được xóa khỏi IndexedDB sau khi dùng, không thể tái tạo
- Vì `EK_priv` và `OPK_priv` đã xóa → **không ai tính lại được SK cho lần đó**

**Giới hạn — không có Double Ratchet:**
- Từ tin nhắn thứ 2 trở đi, 2 user dùng chung 1 `SK` suốt session
- SK chỉ thay đổi khi tạo conversation mới (hiện không có rotation tự động)
- Signal dùng Double Ratchet để đổi key mỗi tin → Post-Compromise Security cao hơn
- Đây là **limitation có chủ đích** — scope đồ án chốt không làm Double Ratchet

**Phương án tương lai:** Có thể thêm key rotation định kỳ (mỗi 100 tin hoặc mỗi ngày) như một extension. Double Ratchet đầy đủ là scope quá lớn cho đồ án 6 tuần.

---

### Q3. "Tại sao dùng Ed25519 cho Identity Key mà không dùng X25519 luôn cho gọn?"

**Trả lời:**

**Hai thuật toán khác nhau về mục đích:**
- **X25519** = Diffie-Hellman → dùng để trao đổi khóa bí mật chung (`crypto_scalarmult`)
- **Ed25519** = Digital Signature → dùng để **ký** và **verify** (`crypto_sign_detached`)

**Tại sao IK phải là Ed25519:**
- IK cần ký lên SPK: `SPK_sig = sodium.crypto_sign_detached(SPK_pub, IK_secret)`
- Chữ ký này để Alice verify SPK là thật khi fetch
- X25519 không có API ký → không thể thay thế

**Tại sao SPK và OPK là X25519:**
- SPK và OPK chỉ tham gia vào DH (`crypto_scalarmult`)
- Không cần ký bằng chính nó
- X25519 nhanh hơn, key nhỏ hơn (32 bytes vs 64 bytes cho secret)

**Vậy bài toán convert ở đâu:**
- Khi làm DH1: `IK_priv × SPK_pub_B` → nhưng `IK_priv` là Ed25519 → phải convert sang X25519 trước
- Dùng: `sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret)` → ra `IK_priv` 32 bytes X25519
- Dùng: `sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B)` → ra `IK_pub_B_x`
- Convert xong → dùng `crypto_scalarmult` bình thường
- Sau khi dùng xong → `IK_priv.fill(0)` xóa ngay

**Lý do thiết kế này (Signal spec):** Dùng 1 key pair cho cả ký lẫn DH làm phân tích bảo mật phức tạp hơn. Tách 2 mục đích ra 2 thuật toán rõ ràng hơn về mặt cryptographic hygiene.

---

### Q4. "AAD là gì? Tại sao cần? Nếu không có AAD thì sao?"

**Trả lời:**

**AAD = Additional Authenticated Data** — dữ liệu được **xác thực nhưng không được mã hóa**.

**Trong hệ thống này:**
```
aad = `${conversationId}:${senderId}`
```
AAD được truyền vào `AES-GCM encrypt` và `AES-GCM decrypt`. Nếu AAD khác nhau giữa 2 lần → decrypt fail.

**Tại sao cần:**
Giả sử không có AAD:
- Alice chat với Bob: ciphertext `C1` với nội dung "OK anh nhé"
- Alice chat với Charlie: SK khác, nhưng ciphertext format giống nhau
- Hacker copy `C1` từ conv Alice-Bob → paste vào conv Alice-Charlie
- Nếu không có AAD: Charlie thấy "OK anh nhé" dù không phải Alice gửi cho anh

**Với AAD:**
- Khi Bob decrypt: `aad = "${convId_AB}:${aliceId}"` → khớp → OK
- Khi hacker paste vào conv Alice-Charlie: `aad = "${convId_AC}:${aliceId}"` → khác → AES-GCM auth tag fail → decrypt trả null
- Message bị tamper cũng phát hiện được: AAD thay đổi → fail ngay

**Tại sao không có timestamp trong AAD:**
Phiên bản đầu có `timestamp` trong AAD, nhưng đồng hồ client và server có thể lệch nhau → timestamp của Alice và Bob có thể khác → cùng 1 tin nhắn nhưng AAD khác nhau → Bob không decrypt được. Quyết định: bỏ timestamp, chỉ dùng `conversationId:senderId` là đủ để chống replay.

---

### Q5. "HKDF là gì? Tại sao cần HKDF sau khi đã có 4 DH output rồi?"

**Trả lời:**

**Vấn đề với DH output thô:**
- `DH1 = crypto_scalarmult(IK_priv, SPK_pub)` → ra 32 bytes
- 32 bytes này **không phải random đều** — có cấu trúc toán học của Curve25519
- Nếu dùng trực tiếp làm AES key → không đạt độ entropy tối đa, dễ bị cryptanalysis

**HKDF (HMAC-based Key Derivation Function) giải quyết:**
1. **Extract:** Ghép `F || DH1 || DH2 || DH3 || DH4` = 160 bytes → IKM
2. **Expand:** HKDF-SHA256 với `info = "E2EEChat_v1"` → ra AES-256 key **đồng đều về mặt thống kê**

**Info string (`"E2EEChat_v1"`) có tác dụng gì:**
- **Domain separation:** nếu cùng IKM nhưng dùng cho mục đích khác (ký, mã hóa metadata, etc.) → info khác → key khác
- Ngăn ngừa key reuse giữa các phiên bản hoặc ứng dụng khác nhau

**F = `0xFF × 32` có tác dụng gì:**
- Theo Signal spec: tiền tố 32 byte `0xFF` để phân biệt với X448 (Curve448)
- Nếu ai implement nhầm dùng X448 với cùng IKM → kết quả vẫn khác → không tương thích nhầm

**Tóm lại:** `4 DH → concat → HKDF → 1 Session Key` = lấy entropy từ 4 nguồn, xử lý thống kê, ra key chất lượng cao.

---

### Q6. "Salt và IV khác nhau thế nào? Hệ thống dùng ở đâu?"

**Trả lời:**

| | Salt (PBKDF2) | IV (AES-GCM) |
|---|---|---|
| Mục đích | Chống rainbow table tấn công password | Đảm bảo cùng plaintext + key → ciphertext khác nhau mỗi lần |
| Kích thước | 16 bytes | 12 bytes (96-bit, chuẩn GCM) |
| Có cần bí mật? | Không — lưu cùng ciphertext là được | Không — gửi kèm ciphertext |
| Dùng lại được không? | Mỗi user 1 salt, giữ cố định suốt đời | Mỗi lần encrypt 1 IV mới — **KHÔNG ĐƯỢC dùng lại** |
| Trong hệ thống này | `wrapSalt` — sinh 1 lần khi register, lưu IndexedDB | `iv` — sinh mới mỗi lần `wrapPrivateKey` và `encryptMessage` |

**Tại sao IV của AES-GCM không được dùng lại:**
- Nếu cùng 1 key + cùng 1 IV mã hóa 2 plaintext khác nhau → **xem được XOR của 2 plaintext**
- Còn tệ hơn: auth tag có thể bị forge → toàn bộ bảo mật sụp đổ
- Trong code: `crypto.getRandomValues(new Uint8Array(12))` mỗi lần encrypt → random, không bao giờ trùng

---

### Q7. "PBKDF2 600.000 iterations nghĩa là gì? Sao không 1 triệu cho chắc?"

**Trả lời:**

**PBKDF2 là gì:**
- Password-Based Key Derivation Function 2
- Lặp hàm hash (SHA-256) N lần trên `(password, salt)` → ra key
- Mục đích: làm cho brute force chậm đến mức không khả thi

**Tại sao 600.000:**
- **OWASP 2023 minimum** cho PBKDF2-SHA256 là 600.000 iterations
- Trên máy thông thường: ~300ms → đủ chậm để ngăn brute force
- 1 triệu iterations → ~500ms → người dùng chờ lâu hơn khi unlock, UX tệ hơn
- Trade-off: security vs. UX — 600k là điểm cân bằng tốt nhất theo OWASP

**Trong hệ thống:**
- Chỉ chạy 1 lần duy nhất khi login hoặc unlock → không ảnh hưởng hiệu năng runtime
- Key chạy xong được lưu vào RAM (`wrappingKey`) → các lần sau dùng lại, không derive nữa

---

### Q8. "Fingerprint 60 chữ số tính như thế nào? SHA-512 lặp 5200 lần có vẻ kỳ lạ?"

**Trả lời:**

**Quy trình tính:**
```
1. Sort: [IK_pub_A, IK_pub_B] theo lexicographic order → [first, second]
   → Alice và Bob gọi với thứ tự khác nhau vẫn ra cùng kết quả

2. Concat: combined = first (32B) || second (32B) = 64 bytes

3. Lặp hash: hash_0 = SHA-512(combined)
             hash_i = SHA-512(hash_{i-1}) × 5199 lần
             → tổng 5200 lần SHA-512

4. Chuyển: 64 bytes hash → hex string → BigInt → mod 10^60 → 60 chữ số thập phân
```

**Tại sao lặp 5200 lần:**
- Chống brute force giả mạo: nếu hacker muốn tạo `IK_pub_fake` có cùng fingerprint với `IK_pub_B` → phải lặp 5200 lần SHA-512 mỗi lần thử → cực kỳ chậm
- Con số 5200 = tham khảo từ Signal Protocol (họ dùng 5200 iterations với SHA-512)
- SHA-512 thay vì SHA-256 → output 64 bytes → nhiều entropy hơn khi lấy 60 chữ số thập phân

**Tại sao 60 chữ số (không phải 64-bit hex):**
- Con người đọc và so sánh số dễ hơn hex
- 60 chữ số = `log2(10^60) ≈ 199 bits` entropy → đủ để tấn công preimage là bất khả thi
- Chia thành 6 nhóm × 10 chữ số → dễ đọc to, so sánh từng nhóm

---

## PHẦN 2: CÂU HỎI VỀ KIẾN TRÚC HỆ THỐNG

---

### Q9. "Blind Server là gì? Server biết được những gì?"

**Trả lời:**

**Server BIẾT:**
- `participantA`, `participantB` → biết ai đang chat với ai (social graph)
- `createdAt` → biết lúc nào
- `ciphertext` (nhưng không đọc được nội dung)
- `ekPub`, `ikPub` (public key thuần túy)
- Kích thước tin nhắn (có thể đoán file hay text)

**Server KHÔNG BIẾT:**
- Nội dung bất kỳ tin nhắn nào
- Private key của bất kỳ user nào
- Password của user (chỉ lưu bcrypt hash)
- Nội dung file/ảnh đã gửi

**Hệ quả thực tế:**
- Admin có toàn quyền DB → vẫn không đọc được tin
- DB bị dump → hacker có ciphertext → không giải mã được
- Server chỉ là "bưu điện mù" — chuyển gói hàng mà không biết bên trong là gì

---

### Q10. "WebSocket security: token được xác thực như thế nào?"

**Trả lời:**

**Quy trình xác thực WS (xem `ws/handler.js`):**

```
Bước 1: Client kết nối ws://server/ws?token=<JWT>
Bước 2: Backend lấy token từ query string: req.url.split('?token=')[1]
Bước 3: jwt.verify(token, JWT_SECRET) → lấy userId
Bước 4: redis.get(`blocklist:${token}`) → nếu "1" → đóng kết nối (logout đã revoke token)
Bước 5: clients.set(userId, ws) → đăng ký vào Map
```

**Tại sao token qua query string (không phải header):**
- Browser WebSocket API (`new WebSocket(url)`) không cho phép set custom header
- Giải pháp phổ biến là query string hoặc sub-protocol trick
- Hạn chế: token có thể xuất hiện trong server log của Nginx → cần cẩn thận ở production
- Giải pháp tốt hơn: sau kết nối, gửi `{type: "auth", token}` trong payload tin đầu tiên (future improvement)

**Membership check chống IDOR:**
- Khi gửi tin qua WS: kiểm tra `conv.participantA === senderId || conv.participantB === senderId`
- Không đủ kiểm tra → trả ACK lỗi, không xử lý

---

### Q11. "JWT blocklist trong Redis hoạt động thế nào? Tại sao cần Redis?"

**Trả lời:**

**Vấn đề với JWT thuần túy:**
- JWT là stateless: server không lưu session → không thể "thu hồi" token khi logout
- Nếu dùng thuần JWT và token bị lộ → hacker dùng được đến khi hết hạn (24 giờ)

**Redis Blocklist giải quyết:**
```
Khi logout: redis.set(`blocklist:${token}`, '1', 'EX', ttl)
  - key: "blocklist:<token>"
  - value: "1"
  - TTL: số giây còn lại của token
  → Khi token hết hạn tự nhiên, Redis tự xóa key (không cần cleanup thủ công)

Khi verify: redis.get(`blocklist:${token}`) → nếu "1" → reject
```

**Tại sao cần Redis (không phải DB):**
- Mỗi request cần check blocklist → phải cực nhanh
- Redis: read trong RAM → microsecond
- PostgreSQL: query → vài millisecond → nhân với 1000 request/giây = bottleneck
- Redis TTL tự động dọn dẹp → không phải viết scheduled cleanup job

**Trong hệ thống:** `backend/redis.js` là singleton, `middleware/auth.js` check mỗi request.

---

### Q12. "Lưu DB trước hay relay WebSocket trước? Tại sao?"

**Trả lời:**

**Hệ thống chọn: Lưu DB trước, relay sau** (xem `ws/handler.js` dòng 170-219)

**Lý do:**
```
Scenario A — lưu sau: relay → DB save
  - Bob nhận tin real-time ✓
  - Server crash trước khi lưu DB
  - Bob reload → không thấy tin (chưa lưu)
  - TIN BỊ MẤT ✗

Scenario B — lưu trước: DB save → relay (hệ thống hiện tại)
  - DB save thành công
  - Server crash trước khi relay
  - Bob offline → không sao, load lịch sử là thấy ✓
  - Bob online → missed real-time nhưng tin vẫn trong DB
  - CHỈ MẤT REAL-TIME, KHÔNG MẤT TIN ✓
```

**Trade-off:** Lưu DB trước chậm hơn 1-5ms (latency PostgreSQL local). Chấp nhận được vì đây là hệ thống chat nội bộ, không phải game FPS.

---

### Q13. "Rate limiting bạn đã làm gì? Chống brute force thế nào?"

**Trả lời:**

**Đã implement (xem `backend/routes/auth.js`):**
```javascript
registerLimiter: 10 requests / 15 phút
loginLimiter:   20 requests / 15 phút
```

**Timing attack protection:**
```javascript
// Luôn chạy bcrypt dù user không tồn tại
const hashToVerify = user ? user.passwordHash : DUMMY_HASH;
const valid = await bcrypt.compare(password, hashToVerify);
```
- Nếu user không tồn tại → response time khác (nếu không dùng dummy hash) → hacker đoán username tồn tại
- Với dummy hash: response time tương đương cả 2 trường hợp → không leak thông tin

**Hạn chế (honest answer):**
- Rate limit theo IP → VPN/proxy rotation vượt qua được
- Chưa có WebSocket rate limit → hacker đã đăng nhập có thể gửi tin rất nhanh
- Production-grade solution: leaky bucket per user ID + captcha + account lockout

---

### Q14. "In-memory Map cho WebSocket — nếu server restart thì sao? Scale lên nhiều server thì sao?"

**Trả lời:**

**Hạn chế đã biết và chủ đích:**

**Server restart:**
- `clients Map` mất → tất cả kết nối WS bị ngắt
- Client có logic reconnect tự động sau 3 giây (`socket.js`)
- Tin nhắn không mất (đã lưu DB trước khi relay)
- User chỉ cần reconnect → load lịch sử → không mất gì

**Scale nhiều server (horizontal scaling):**
- `clients Map` chỉ sống trên 1 server
- Nếu Alice kết nối server A, Bob kết nối server B → A không có Bob trong Map → không relay được
- Giải pháp: Redis Pub/Sub (mỗi server subscribe channel → publish message cho server khác)
- Đây là **phương án tương lai** — scope đồ án chốt 1 server instance
- Đủ cho demo doanh nghiệp nhỏ (< 1000 user đồng thời)

**Câu trả lời thẳng thắn:** Hệ thống này thiết kế cho 1 instance. Để scale: thay Map bằng Redis Pub/Sub hoặc chuyển sang Socket.IO với Redis adapter.

---

## PHẦN 3: CÂU HỎI VỀ BẢO MẬT PHÍA CLIENT

---

### Q15. "Private key lưu ở đâu? Có an toàn không?"

**Trả lời:**

**Quy trình lưu private key (IndexedDB + wrap):**

```
Bước 1: Sinh key → IK_secret (64B Ed25519), SPK_priv (32B X25519), 100 OPK_priv
Bước 2: deriveWrappingKey(password, salt)
  - PBKDF2-SHA256 × 600.000 iterations → AES-256 CryptoKey
  - wrappingKey KHÔNG thể export (extractable: false)
Bước 3: wrapPrivateKey(IK_secret, wrappingKey)
  - IV = crypto.getRandomValues(12B) → random mỗi lần
  - AES-GCM encrypt → ciphertext base64
  - Lưu {wrapped, iv} vào IndexedDB
Bước 4: Tương tự với SPK_priv và tất cả OPK_priv
```

**Kẻ tấn công cần gì để lấy được private key:**
- Access IndexedDB (XSS attack hoặc physical access máy tính)
- Phải có password của user để derive wrappingKey
- Không có password → chỉ thấy `{wrapped, iv}` vô nghĩa

**Tại sao không dùng `extractable: false` cho SK:**
- SK (Session Key) cần lưu IndexedDB để tồn tại qua reload
- `extractable: false` → không thể `exportKey()` → không lưu được
- Trade-off: dùng `extractable: true` → lưu raw bytes vào IndexedDB, nhưng vẫn được bảo vệ bởi wrappingKey nếu leak

---

### Q16. "XSS attack là gì? Nó phá vỡ E2EE thế nào? Bạn xử lý chưa?"

**Trả lời:**

**XSS phá vỡ E2EE thế nào:**
- Nếu attacker inject được JS vào trang → JS đó chạy cùng origin → truy cập được IndexedDB
- Đọc `{wrapped, iv}` → không đủ (cần password)
- Nhưng có thể **hook vào hàm `unlock()`** → capture password khi user nhập
- Hoặc đọc `wrappingKey`, `IK_secret`, `SPK_priv` từ RAM nếu đang trong state

**Hệ thống đã có:**
- React tự động escape HTML → text content an toàn khỏi reflected XSS
- Vite build → bundle nghiêm ngặt, không dùng `dangerouslySetInnerHTML`

**Chưa có (honest answer):**
- CSP (Content Security Policy) header chưa được config trong Nginx
- SRI (Subresource Integrity) chưa có

**Phương án tương lai:**
```
# Nginx config thêm header:
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```
- Block mọi script từ external domain
- Block inline script (trừ Tailwind — cần unsafe-inline cho style)
- Giảm thiểu đáng kể XSS attack surface

---

### Q17. "Memory dump — private key có bị lấy được không?"

**Trả lời:**

**Hệ thống đã xử lý:**
Sau mỗi phép DH, xóa key tạm khỏi RAM ngay:
```javascript
// performX3DH_sender — sau khi tính xong SK:
DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
IK_priv.fill(0);       // X25519 key tạm — xóa ngay
EK.privateKey.fill(0); // EK dùng 1 lần — xóa ngay

// performX3DH_receiver — sau khi tính xong SK:
IK_priv.fill(0);  // X25519 key tạm
OPK_priv.fill(0); // OPK đã dùng → xóa, không dùng lại bao giờ
```

**Hạn chế còn lại:**
- `IK_secret`, `SPK_priv`, `wrappingKey` sống trong RAM (`AuthContext` state) suốt phiên làm việc
- Nếu máy bị malware có khả năng dump RAM process → có thể lấy được
- Giải pháp: `isLocked` state — sau X phút không hoạt động → xóa RAM state, yêu cầu nhập password lại (UnlockModal)
- Hiện chưa có auto-lock timeout — phương án tương lai

**JavaScript không kiểm soát được GC:** `fill(0)` là best effort, GC có thể đã copy dữ liệu trước đó. Đây là hạn chế cố hữu của Web platform, không phải bug của code.

---

## PHẦN 4: CÂU HỎI VỀ THIẾT KẾ NGHIỆP VỤ

---

### Q18. "Nếu user mất điện thoại / máy tính → mất private key → mất hết tin nhắn cũ?"

**Trả lời:**

**Câu trả lời thẳng thắn: Đúng, đây là đặc tính của E2EE thực sự.**

**Tại sao phải như vậy:**
- Nếu server lưu private key → server có thể giải mã → không phải E2EE
- Nếu có account recovery qua email/SMS → phải gửi key qua network → không phải E2EE

**Hệ thống này handle:**
- `DEVICE_NOT_REGISTERED` error khi login trên máy mới (chưa có IndexedDB)
- Người dùng biết rõ: mỗi thiết bị là độc lập, không sync key tự động

**Phương án backup (phương án tương lai):**
- Export file `.e2ee` = toàn bộ key bundle đã wrap, mã hóa bằng recovery password
- User lưu file này ở nơi an toàn (USB, ổ cứng ngoài)
- Khi mất máy: import file + nhập recovery password → khôi phục được key
- Signal cũng dùng approach tương tự (Transfer account)

**Đây không phải bug, đây là thiết kế đúng đắn của E2EE.**

---

### Q19. "Group chat E2EE của bạn hoạt động như thế nào? Sao không dùng Sender Keys?"

**Trả lời:**

**Thiết kế "N tin 1-1 song song":**
- Group có N thành viên → gửi tin = gửi N tin 1-1, mỗi tin mã hóa riêng cho từng người
- SK của nhóm = `Map<${groupId}:${recipientId}, CryptoKey>` (sender) / `Map<${groupId}:${senderId}, CryptoKey>` (receiver)
- Server lưu N bản ciphertext, relay N tin

**Ưu điểm:**
- Đơn giản, code tái sử dụng gần như hoàn toàn từ 1-1
- Không cần protocol mới, không cần Group Session State phức tạp

**Nhược điểm (honest):**
- Gửi 1 tin trong nhóm 10 người → 10 DB row → N× storage
- Sender gửi N lần qua POST /messages → N× network round-trip
- Sender Keys (Signal) giải quyết: mã hóa 1 lần, broadcast 1 ciphertext cho N người

**Tại sao không dùng Sender Keys:**
- Sender Keys cần Group Session State phức tạp: khi thêm/xóa thành viên phải rotate key, re-distribute
- Scope quá lớn, phức tạp hơn nhiều
- Với nhóm doanh nghiệp nhỏ (< 20 người), N× overhead không đáng kể

**File trong group — tối ưu hơn:**
- File dùng random `fileKey` → mã hóa file 1 lần duy nhất → upload 1 bản
- Mỗi member nhận message payload chứa `fileKey` (mã hóa bằng SK riêng của người đó)
- Server chỉ lưu 1 encrypted file, không tốn N× storage cho file

---

### Q20. "Khi thêm thành viên mới vào nhóm, họ có đọc được lịch sử cũ không?"

**Trả lời:**

**Câu trả lời: Không đọc được — đây là đúng về bảo mật.**

**Tại sao:**
- Mỗi tin nhắn cũ được mã hóa bằng SK của từng cặp (sender → member_cũ)
- Thành viên mới không có các SK đó → không giải mã được
- Server cũng không thể "re-encrypt" vì không có plaintext

**Behavior thực tế:**
- Khi C được thêm vào nhóm → C thấy nhóm trong danh sách
- Lịch sử cũ khi C load → decrypt fail → hiển thị "Không thể giải mã" (đúng UX)
- Từ tin nhắn được gửi **sau khi C được thêm** → C nhận SK từ X3DH → giải mã được

**So sánh với Signal:** Signal Groups cũng không cho thành viên mới xem lịch sử cũ. MLS protocol có thể làm được nhưng phức tạp hơn rất nhiều.

---

### Q21. "Tại sao cần Fingerprint verify trước khi chat 1-1? Signal không bắt buộc mà?"

**Trả lời:**

**Hệ thống yêu cầu verify fingerprint trước khi gửi tin 1-1.**

**Lý do thiết kế:**
- Hệ thống nội bộ doanh nghiệp → người dùng biết nhau → verify dễ (gặp trực tiếp/gọi điện)
- Nếu không verify → về lý thuyết admin có thể thay public key để MITM
- Doanh nghiệp cần bảo đảm 100% tin nhắn không bị MITM → require verify

**So sánh với Signal:**
- Signal KHÔNG bắt buộc verify Safety Numbers
- Nhưng Signal dùng cho người lạ → verify khó hơn (không biết nhau)
- Dự án này ngược lại → bắt verify là hợp lý hơn Signal trong context doanh nghiệp

**Group chat không block:**
- Group có thể gửi tin kể cả chưa verify hết (giống Signal)
- Badge header "X/Y đã xác minh" → nhắc nhở nhưng không block
- Verify 1 lần với Bob → tự động có tác dụng ở mọi nhóm có Bob (global PeerVerification)

---

### Q22. "Nếu Admin bị tấn công — họ có đọc được tin nhắn của nhân viên không?"

**Trả lời:**

**Câu trả lời: Không.**

**Admin có thể làm:**
- Xem danh sách user, vô hiệu hóa tài khoản
- Thêm/xóa email whitelist
- Xem DB: có ciphertext nhưng không giải mã được
- Thêm user mới → user đó có thể chat với nhân viên (nhưng vẫn cần verify fingerprint)

**Admin KHÔNG thể làm:**
- Đọc bất kỳ tin nhắn nào (plaintext)
- Thay public key của user (không có API này — sau register không được sửa IK)
- Truy cập private key (không lưu server)

**Nếu Admin muốn MITM:**
- Thêm user giả vào whitelist → tạo account mới → mời vào nhóm → nhưng fingerprint sẽ khác với nhân viên thật → bị phát hiện khi verify

**Đây là Blind Server model:** Admin = người vận hành nhưng không có quyền đọc nội dung.

---

## PHẦN 5: CÂU HỎI VỀ DATABASE VÀ HIỆU NĂNG

---

### Q23. "Index database của bạn như thế nào? Tại sao cần index?"

**Trả lời:**

**Index là gì:** Cấu trúc dữ liệu B-tree giúp PostgreSQL tìm kiếm nhanh mà không phải scan toàn bộ bảng.

**Index trong schema:**
```prisma
Message: @@index([conversationId, createdAt])
  → Query "lấy 20 tin mới nhất của conv X" = O(log N) thay vì O(N)

Message: @@index([groupId, createdAt])
  → Query "lấy tin nhắn group X" tương tự

GroupMember: @@unique([groupId, userId])
  → Không cho join nhóm 2 lần, lookup O(log N)

PeerVerification: @@unique([verifierId, peerId])
  → Không verify 2 lần, idempotent upsert nhanh
```

**Cursor pagination thay vì offset:**
```
Offset: SELECT ... LIMIT 20 OFFSET 1000 → PostgreSQL phải skip 1000 row = O(N)
Cursor: SELECT ... WHERE createdAt < cursor ORDER BY createdAt DESC LIMIT 20 → O(log N) với index
```
Với 73 triệu tin nhắn/năm → cursor pagination là bắt buộc.

---

### Q24. "Docker Compose của bạn có 4 service. Production thì deploy thế nào?"

**Trả lời:**

**4 service:**
1. `postgres` — PostgreSQL 16 + volume `postgres_data` (data tồn tại qua restart)
2. `redis` — Redis 7 (JWT blocklist, không cần persist)
3. `backend` — Node.js Express + WS, `prisma migrate deploy` khi khởi động
4. `frontend` — Nginx serve static + reverse proxy `/api` → backend:3000

**Deploy 1 lệnh:**
```bash
docker compose up --build -d
```

**Nginx xử lý:**
- `/api/*` → proxy_pass `http://backend:3000`
- `/ws` → WebSocket upgrade + proxy
- `/*` → serve `frontend/dist/` (SPA fallback: 404 → index.html)
- TLS termination: trong production thêm Let's Encrypt hoặc công ty certificate

**Hạn chế production-grade:**
- Chưa có HTTPS trong docker-compose (chỉ HTTP) → phải thêm TLS certificate
- Nginx chưa config HSTS, CSP header
- Không có load balancer (1 instance) → Single Point of Failure

---

## PHẦN 6: CÂU HỎI NGOÀI LỀ CÓ THỂ HỎI THÊM

---

### Q25. "Tại sao chọn X3DH mà không phải RSA? RSA không an toàn hơn sao?"

**Trả lời:**

| | RSA-2048 | X3DH (Curve25519) |
|---|---|---|
| Key size | 2048 bits = 256 bytes | 32 bytes |
| Tốc độ | ~1ms/operation | ~0.1ms |
| Forward Secrecy | Không (static key pair) | Có (ephemeral key) |
| Quantum resistance | Cả hai đều không có |
| Chuẩn hiện tại | RSA đang bị deprecated | NIST recommend P-256/Curve25519 |

**X3DH vượt trội RSA vì:**
1. **Ephemeral key** → Forward Secrecy (RSA không có)
2. **4 DH kết hợp** → mutual authentication + forward secrecy cùng lúc
3. **Nhỏ hơn, nhanh hơn** → quan trọng cho mobile
4. **Signal, WhatsApp, iMessage đều dùng** → battle-tested

---

### Q26. "Tại sao AES-GCM mà không phải AES-CBC?"

**Trả lời:**

| | AES-CBC | AES-GCM |
|---|---|---|
| Mode | Confidentiality only | Authenticated Encryption (AEAD) |
| Auth tag | Không có — phải thêm HMAC riêng | Có sẵn 128-bit auth tag |
| Padding oracle | Dễ bị tấn công nếu implement sai | Không cần padding |
| AAD support | Không | Có — chống replay/tamper |
| NIST recommendation | Legacy | Recommended |

**AES-GCM = confidentiality + integrity + authenticity trong 1 lần:**
- Nếu ciphertext bị sửa 1 bit → auth tag fail → decrypt trả lỗi ngay
- Không cần code HMAC riêng → ít code → ít bug hơn

**Hệ thống này dùng AES-256-GCM** = key 256-bit → bảo mật tối đa theo NIST.

---

### Q27. "bcrypt cost 12 nghĩa là gì? Sao không Argon2?"

**Trả lời:**

**bcrypt cost 12:**
- bcrypt lặp `2^cost` lần → cost 12 = 4096 iterations
- Trên máy thông thường: ~300ms/hash
- 300ms đủ chậm để ngăn brute force (~3 hash/giây/CPU)

**Tại sao không Argon2:**
- Argon2id tốt hơn bcrypt: memory-hard → chống GPU attack
- **Nhưng**: thầy hướng dẫn đề xuất dùng bcrypt vì đơn giản hơn, dễ giải thích hơn trong báo cáo
- bcrypt vẫn là chuẩn được chấp nhận rộng rãi (OWASP approved)
- Quyết định đổi Argon2 → bcrypt được ghi trong PROGRESS.md (ngày 7)

---

### Q28. "Người dùng bị vô hiệu hóa (disabled) — tin nhắn cũ có đọc được không?"

**Trả lời:**

**Khi user bị admin disable:**
- Không đăng nhập được (`isActive` check trong login)
- Ẩn khỏi search kết quả
- Người khác không gửi tin mới được (POST /messages check recipient isActive)
- Conversation cũ **vẫn đọc được** → người còn lại vẫn thấy lịch sử

**Tại sao conversation cũ vẫn đọc được:**
- Ciphertext đã lưu DB + SK đã có trong IndexedDB của người còn lại
- SK không bị xóa khi đối phương bị disable
- Thiết kế đúng: không nên xóa lịch sử của người còn lại

**Chat.jsx hiển thị:**
- Banner "Người dùng này đã không còn trong tổ chức" thay thế MessageInput
- Không crash, không mất dữ liệu

---

## PHẦN 7: CÁC HẠN CHẾ VÀ PHƯƠNG ÁN TƯƠNG LAI

### Tổng hợp các hạn chế đã biết (trả lời thành thật)

| Hạn chế | Lý do chủ đích | Phương án tương lai |
|---|---|---|
| Không có Double Ratchet | Scope quá lớn, phức tạp | Implement DR là bước tiếp theo tự nhiên |
| Single-device only | Đơn giản hóa key management | Export/import `.e2ee` file |
| In-memory WS (1 server) | Đủ cho demo 1 instance | Redis Pub/Sub khi scale |
| Chưa có CSP header | Chưa đến tuần hardening | Config Nginx + meta tag |
| Không có auto-lock timeout | Chưa implement | Set timer clear RAM state sau 15 phút idle |
| Group file upload 1 bản | Đã tối ưu (random fileKey) | Đã xong |
| Không có message search | Server không đọc được content | Client-side full-text search (future) |
| WS token qua query string | Browser API limitation | Post-connect auth message |
| Không có HTTPS trong docker-compose | Dev environment | Thêm Let's Encrypt cert + HSTS |

---

## PHẦN 8: LUỒNG E2EE ĐẦU ĐẾN CUỐI (ĐỂ DEMO)

### Alice gửi tin đầu tiên cho Bob

```
1. Alice login → PBKDF2(password, wrapSalt) → wrappingKey → decrypt IK_secret, SPK_priv từ IndexedDB

2. Alice tìm Bob, tạo conversation → GET /keys/bob_id
   → Server trả: { ikPub, spkPub, spkSig, opkPub, opkId }

3. Alice verify fingerprint với Bob (gọi điện so 60 số)

4. Alice nhập tin nhắn → SEND:
   a. verifySignedPreKey(ikPub_B, spkSig, spkPub_B) → OK
   b. performX3DH_sender → { SK, EK_pub, OPK_id, IK_pub }
   c. encryptMessage("Xin chào!", SK, convId, aliceId) → { ciphertext, iv, aad }
   d. WS.send({ type:"message", ciphertext, iv, aad, ekPub, opkId, ikPub })

5. Server nhận WS:
   a. Membership check (Alice là thành viên conv) ✓
   b. prisma.message.create({ ciphertext, iv, aad, ekPub, opkId, ikPub })
   c. Relay { type:"message", ... } đến Bob's socket
   d. ACK đến Alice

6. Bob nhận WS message:
   a. Có ekPub → performX3DH_receiver:
      - getOPK(opkId) → OPK_priv (1 decrypt từ IndexedDB)
      - 4 DH ngược → SK (giống hệt SK của Alice)
      - OPK_priv.fill(0) → xóa
   b. decryptMessage(ciphertext, iv, aad, SK) → "Xin chào!" ✓
   c. Lưu SK vào IndexedDB + RAM cache

7. Tin thứ 2 trở đi: SK đã có trong RAM cache → chỉ cần encryptMessage/decryptMessage
```

---

*Chúc bạn phản biện thành công! Mọi câu hỏi trong kịch bản đều có câu trả lời rõ ràng từ code thực tế.*
