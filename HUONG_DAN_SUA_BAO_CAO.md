# Hướng dẫn chỉnh sửa báo cáo ĐATN

> Tài liệu do GVHD tổng hợp sau khi đối chiếu **báo cáo** với **mã nguồn thực tế**.
> Mục tiêu: sửa các chỗ sai sự thật, đồng bộ báo cáo ↔ code, và làm giọng văn "người viết" hơn.
>
> **Quy ước mức độ:**
> - 🔴 **PHẢI SỬA** — sai sự thật so với code, dễ bị hội đồng bắt lỗi.
> - 🟡 **NÊN SỬA** — mâu thuẫn nội bộ / mô tả chưa chính xác.
> - 🟢 **NÊN BỔ SUNG** — thêm vào để báo cáo mạnh và trung thực hơn.

---

## MỤC LỤC NHANH

1. [Bảng tổng hợp lỗi theo chương](#1-bảng-tổng-hợp-lỗi-theo-chương)
2. [Chi tiết từng lỗi và cách sửa](#2-chi-tiết-từng-lỗi-và-cách-sửa)
3. [Góp ý giọng văn — viết như người, không như AI](#3-góp-ý-giọng-văn--viết-như-người-không-như-ai)
4. [Checklist trước khi nộp](#4-checklist-trước-khi-nộp)

---

## 1. Bảng tổng hợp lỗi theo chương

| # | Mức | Vị trí trong báo cáo | Vấn đề | File code đối chiếu |
|---|-----|----------------------|--------|---------------------|
| ① | 🔴 | Tóm tắt, Abstract, mục 1.2.4, scope | Ghi file tối đa **10MB**, code chỉ cho **5MB** (backend chặn 7MB) | `frontend/src/components/MessageInput.jsx:46,62`, `backend/routes/files.js:19` |
| ② | 🔴 | Pseudocode 3.5.5, Phụ lục D.6 | Vòng lặp ghi `SHA-512(h‖pub)`, code chỉ `SHA-512(h)` (không nối pub) | `frontend/src/crypto/fingerprint.js:20-23` |
| ③ | 🔴 | Mục 2.3.7 | Nói fingerprint sinh từ "khóa định danh **và định danh người dùng**"; code chỉ dùng 2 IK_pub | `frontend/src/crypto/fingerprint.js:8-15` |
| ④ | 🔴 | Bảng 3.2 (bước 4), Hình 3.6 | Mô tả register gửi kèm key bundle trong 1 request; thực tế upload key **riêng** sau khi login | `backend/routes/auth.js:17-83`, `backend/routes/keys.js:16` |
| ⑤ | 🔴 | Mục 4.5 (ý iii) | "Redis hỗ trợ hàng đợi và bộ đệm"; code chỉ dùng Redis cho blocklist JWT, tin offline lưu PostgreSQL | `backend/ws/handler.js:169-210`, `backend/redis.js` |
| ⑥ | 🔴 | Hình 3.11 (ERD) | `UploadedFile` vẽ có `storedName, mimeType, size` (không có thật); `Group` thiếu `adminId` | `backend/prisma/schema.prisma:67-79, 103-108` |
| ⑦ | 🔴 | Mục 3.5.5 (câu lý giải) | "Lặp băm làm tăng chi phí tạo **va chạm**" — sai về mật mã | (lý thuyết) |
| ⑧ | 🟡 | Pseudocode 3.5.1 | `IK = X25519.generateKeyPair()`; thực tế IK là **Ed25519** convert sang X25519 khi DH | `frontend/src/crypto/keyGen.js:21`, `frontend/src/crypto/x3dh.js:66` |
| ⑨ | 🟡 | Pseudocode 3.5.3 | Thiếu tiền tố `F = 0xFF×32` trong IKM (Hình 2.3 lại có) | `frontend/src/crypto/x3dh.js:76-77` |
| ⑩ | 🟡 | Mục 1.3.2 ↔ 4.5 | Mô tả "5 container" không nhất quán; không có container nginx riêng (nginx nằm trong frontend) | `docker-compose.yml`, `frontend/nginx.conf` |
| ⑪ | 🟡 | Mục 2.3.5 | AAD nói buộc "người gửi và người nhận"; code = `conversationId:senderId` | `frontend/src/crypto/aesGcm.js:68` |
| ⑫ | 🟢 | Mục 5.2 (Hạn chế) | Chưa nêu: Redis chết thì middleware **fail-open** (bỏ qua blocklist) | `backend/middleware/auth.js:28-31` |
| ⑬ | 🟢 | Chương 4 (Triển khai) | Chưa nêu: cơ chế `ADMIN_SEED_EMAIL` bootstrap admin, bypass whitelist | `backend/routes/auth.js:44-53` |
| ⑭ | 🟢 | Mục 4.6 (Hiệu năng) | Số liệu mới là "minh họa", chưa có phương pháp đo + benchmark throughput thật | `backend/benchmark.js`, `benchmark/` |
| ⑮ | 🟢 | Chương 4 | Chưa khai thác điểm tốt của code: chống timing attack, `$transaction` chống race, xóa key khỏi RAM | `auth.js:14,66-75`, `x3dh.js:84-86` |

---

## 2. Chi tiết từng lỗi và cách sửa

### ① 🔴 Dung lượng file: 10MB → 5MB

**Sửa ở:** Tóm tắt nội dung, Abstract, mục 1.2.4 (Phạm vi), danh sách scope.

- Code frontend chặn file > **5MB** plaintext (`MessageInput.jsx:46,62`).
- Code backend (multer) chặn **7MB** sau mã hóa (`files.js:19` → `fileSize: 7 * 1024 * 1024`).

**Cách viết lại (gợi ý):**
> "...gửi file và ảnh với mã hóa đầu cuối, dung lượng tối đa **5MB** mỗi tệp (giới hạn ở tầng máy chủ đặt **7MB** để bù phần overhead sinh ra khi mã hóa AES-GCM và đóng gói multipart)."

> ⚠️ Sửa **tất cả** chỗ xuất hiện "10MB" trong báo cáo cho đồng bộ.

---

### ② 🔴 Pseudocode Fingerprint sai vòng lặp

**Sửa ở:** Pseudocode mục 3.5.5 và Phụ lục D.6.

Code thật (`fingerprint.js:20-23`):
```js
let hash = await crypto.subtle.digest('SHA-512', combined);
for (let i = 0; i < 5199; i++) {
  hash = await crypto.subtle.digest('SHA-512', hash);   // CHỈ băm hash, KHÔNG nối pub
}
```

**Pseudocode đúng cần sửa thành:**
```
function iterate(seed, n):
    h = SHA-512(seed)          // seed = IK_pub_A_sorted || IK_pub_B_sorted
    repeat (n - 1) times:
        h = SHA-512(h)         // băm lại chính giá trị hash, không nối thêm gì
    return h
```

> Lưu ý: báo cáo đang mô tả lặp 5200 vòng — code = 1 lần băm đầu + 5199 lần lặp = **5200 lần** ✓ (con số đúng, chỉ sai công thức bên trong).

---

### ③ 🔴 Fingerprint không gồm "định danh người dùng"

**Sửa ở:** mục 2.3.7 (và bất kỳ chỗ nào mô tả tương tự).

Câu hiện tại sai: *"...sinh ra một cách tất định từ khóa định danh công khai **và định danh của hai người dùng**..."*

Code (`fingerprint.js:8-15`) chỉ băm 2 khóa `IK_pub` (64 byte), **không** có userId/email.

**Có 2 hướng — chọn 1:**

- **Hướng A (nhanh, sửa văn):** bỏ cụm "và định danh của hai người dùng":
  > "...sinh ra một cách tất định từ **hai khóa định danh công khai** của hai người dùng, bằng cách băm lặp nhiều lần với SHA-512."

- **Hướng B (tốt hơn về bảo mật, sửa code rồi giữ văn):** thêm userId vào input băm trong `fingerprint.js` (giống Signal trộn identifier), để chống trường hợp một IK_pub bị tái dùng nhầm ngữ cảnh. Nếu chọn hướng này thì giữ nguyên câu chữ và ghi chú "đã trộn định danh người dùng vào đầu vào băm".

> GVHD khuyến nghị **Hướng B** nếu còn thời gian, vì đúng tinh thần Safety Number của Signal.

---

### ④ 🔴 Luồng đăng ký: tách register và upload key

**Sửa ở:** Bảng 3.2 (đặc tả use case Đăng ký, bước 4) và Hình 3.6 (sơ đồ tuần tự Đăng ký).

Thực tế trong code:
1. `POST /auth/register` **chỉ** tạo tài khoản (username/email/passwordHash), KHÔNG nhận key (`auth.js:17-83`).
2. Sau khi đăng nhập có JWT, client mới gọi `POST /keys/upload` (có `requireAuth`) để đẩy public key bundle (`keys.js:16`).

**Sửa Bảng 3.2 — tách bước 4 cũ thành 2 bước:**
> 4. Trình duyệt gửi `POST /auth/register` **chỉ gồm thông tin tài khoản** (username, email); mật khẩu được băm bằng bcrypt phía máy chủ.
> 5. Sau khi đăng nhập thành công và có JWT, trình duyệt gọi `POST /keys/upload` để tải **gói khóa công khai** (IK, SPK, chữ ký SPK, danh sách OPK) lên máy chủ.

**Sửa Hình 3.6:** thêm một nhịp riêng "POST /keys/upload (sau khi có token)" thay vì gộp key vào lời gọi `/auth/register`.

> Đây là chi tiết kiến trúc dễ bị hỏi: "lúc chưa có token thì upload key kiểu gì?". Sửa để khớp code.

---

### ⑤ 🔴 Vai trò Redis ở mục 4.5

**Sửa ở:** mục 4.5 (Triển khai hệ thống), ý liệt kê dịch vụ (iii).

Câu hiện tại sai: *"(iii) Redis hỗ trợ hàng đợi và bộ đệm"*.

Thực tế:
- Redis **chỉ** dùng cho blocklist JWT (`auth.js:131`, `middleware/auth.js:26`, `ws/handler.js:52`).
- Tin nhắn offline được **lưu vào PostgreSQL** rồi load lại khi online (`handler.js:169-210`), KHÔNG qua Redis.

**Sửa thành:**
> "(iii) Redis lưu **danh sách thu hồi JWT (blocklist)**; tin nhắn gửi tới người dùng ngoại tuyến được lưu trực tiếp trong PostgreSQL và tải lại khi họ kết nối lại."

> Mục 1.3.2, 2.5, 3.8 đã ghi đúng (Redis chỉ blocklist) → chỉ cần sửa 4.5 cho khớp.

---

### ⑥ 🔴 Hình ERD (3.11) lệch thuộc tính

**Sửa ở:** Hình 3.11 (Biểu đồ thực thể quan hệ) và phần mô tả 9 thực thể.

- `UploadedFile`: hình vẽ ghi `storedName, mimeType, size` — **không có thật**. Model chỉ có `id, uploaderId, createdAt` (`schema.prisma:103-108`). Metadata file (tên, kiểu, kích thước) nằm trong **payload tin nhắn đã mã hóa**, không lưu DB → **đây là điểm cộng bảo mật, nên nói rõ**.
- `Group`: hình thiếu trường `adminId` (model có, `schema.prisma:71`) — dùng để chuyển quyền admin.

**Cách sửa:**
- Vẽ lại `UploadedFile` chỉ còn `id, uploaderId, createdAt`.
- Thêm `adminId` vào `Group`.
- Thêm 1 câu: *"Metadata của file (tên, kiểu MIME, kích thước) không được lưu trong cơ sở dữ liệu mà nằm trong payload tin nhắn đã mã hóa, nhất quán với mô hình máy chủ mù."*

---

### ⑦ 🔴 Lý giải sai về "va chạm" ở mục 3.5.5

**Sửa ở:** câu giải thích dưới Hình 3.10, mục 3.5.5.

Câu hiện tại sai về mật mã: *"Việc lặp băm làm tăng chi phí tính toán cho kẻ tấn công muốn tạo va chạm"*.

→ Lặp băm **không** làm tăng kháng va chạm của SHA-512 (vốn đã ~2^256). Mục đích thật của việc lặp (giống Signal) là **làm chậm việc brute-force để ép một khóa giả khớp đúng 60 chữ số rút gọn hiển thị**, đồng thời tạo giá trị ổn định, dễ đọc.

**Sửa thành:**
> "Việc lặp băm nhiều vòng làm cho mỗi lần thử của kẻ tấn công (muốn tạo ra một khóa giả mà chuỗi 60 chữ số rút gọn vẫn trùng với chuỗi của nạn nhân) trở nên tốn kém hơn đáng kể, trong khi vẫn đủ nhanh để người dùng tính một lần lúc xác minh."

---

### ⑧ 🟡 Pseudocode 3.5.1 ghi sai loại khóa IK

**Sửa ở:** pseudocode mục 3.5.1.

Hiện ghi `IK = X25519.generateKeyPair()`. Thực tế IK là **Ed25519** (`crypto_sign_keypair`, `keyGen.js:21`), khi cần DH mới convert sang X25519 (`x3dh.js:66`). **Phụ lục D.1 đã ghi đúng** ("Ed25519") → đang mâu thuẫn nội bộ.

**Sửa pseudocode 3.5.1 thành:**
```
IK  = Ed25519.generateKeyPair()   // khóa định danh, dùng để KÝ
SPK = X25519.generateKeyPair()    // khóa ký trước, dùng để DH
sig = Ed25519.sign(IK.priv, SPK.pub)
// Khi thực hiện X3DH: convert IK (Ed25519) -> X25519 để tính DH
```

---

### ⑨ 🟡 Pseudocode 3.5.3 thiếu tiền tố F

**Sửa ở:** pseudocode mục 3.5.3.

Code (`x3dh.js:76-77`) ghép IKM có tiền tố `F = 0xFF × 32`:
```
F   = 0xFF repeated 32 bytes
IKM = F || DH1 || DH2 || DH3 || DH4
SK  = HKDF-SHA256(IKM)
```
Hình 2.3 đã thể hiện F → sửa pseudocode cho khớp (thêm dòng F vào trước SK).

---

### ⑩ 🟡 Mô tả "5 container" không nhất quán

**Sửa ở:** mục 4.5 (và đối chiếu với 1.3.2).

5 service thật trong `docker-compose.yml`: `postgres`, `redis`, `backend`, `frontend`, `cloudflared`.
- **Không có** container nginx riêng. Nginx **chạy bên trong** container `frontend` (`frontend/nginx.conf`) để phục vụ SPA + reverse proxy. (Thư mục `nginx/` ở gốc dự án rỗng.)

**Sửa 4.5 thành (đồng bộ với 1.3.2):**
> 5 dịch vụ gồm: (i) **backend** — máy chủ ứng dụng (REST + WebSocket); (ii) **postgres** — PostgreSQL 16 lưu dữ liệu mã hóa + metadata; (iii) **redis** — danh sách thu hồi JWT; (iv) **frontend** — container Nginx phục vụ SPA tĩnh và reverse proxy tới backend; (v) **cloudflared** — Cloudflare Tunnel.

---

### ⑪ 🟡 Mô tả AAD chưa khớp

**Sửa ở:** mục 2.3.5.

Code (`aesGcm.js:68`): `aad = ${conversationId}:${senderId}`.

Câu báo cáo: *"gắn các định danh người gửi **và người nhận**"* — chưa chính xác (thực tế buộc theo **cuộc hội thoại + người gửi**).

**Sửa thành:**
> "...gắn **định danh cuộc hội thoại và định danh người gửi** vào nhãn xác thực, nhờ đó một bản mã bị sửa đổi hoặc bị phát lại sang cuộc hội thoại khác sẽ bị phát hiện."

---

### ⑫ 🟢 Bổ sung hạn chế: Redis fail-open

**Bổ sung ở:** mục 5.2 (Hạn chế), nhóm "vận hành".

Code (`middleware/auth.js:28-31`): nếu Redis lỗi/khởi động không xong, middleware **bỏ qua** kiểm tra blocklist và cho request đi tiếp (fail-open).

**Thêm 1 ý:**
> "Cơ chế kiểm tra thu hồi token hiện hoạt động theo kiểu fail-open: khi Redis không sẵn sàng, hệ thống bỏ qua bước kiểm tra blocklist để ưu tiên tính sẵn sàng. Hướng cải thiện là chuyển sang fail-closed hoặc bổ sung cảnh báo giám sát khi Redis gặp sự cố."

---

### ⑬ 🟢 Bổ sung: cơ chế bootstrap admin

**Bổ sung ở:** mục 4.2.1 (Module quản lý và phân quyền) hoặc Phụ lục.

Code (`auth.js:44-53`): email cấu hình qua biến môi trường `ADMIN_SEED_EMAIL` được **bypass whitelist** và **tự gán role ADMIN** khi đăng ký lần đầu — để giải bài toán "chicken-and-egg" (chưa có admin nào để thêm whitelist).

**Thêm 1 đoạn ngắn** giải thích cơ chế này (kèm lưu ý đây là tài khoản hạt giống, do IT đặt lúc triển khai).

---

### ⑭ 🟢 Củng cố chương Hiệu năng (4.6)

- Hiện số liệu là "minh họa bậc độ lớn". Hội đồng an ninh sẽ hỏi **phương pháp đo**.
- File `backend/benchmark.js` mới chỉ đo bcrypt; có thư mục `benchmark/`.

**Nên làm:**
1. Đo thật mỗi thao tác **N lần** (ví dụ 100 lần), ghi **trung bình + độ lệch chuẩn**.
2. Ghi rõ **cấu hình máy đo** (CPU, RAM, trình duyệt, phiên bản).
3. Nếu scope có "benchmark WebSocket throughput" → bổ sung số liệu throughput thật (tin/giây) hoặc nói rõ vì sao chỉ đánh giá định tính.

---

### ⑮ 🟢 Khai thác điểm tốt của code (đang bị bỏ phí)

Code có vài chi tiết bảo mật tốt mà báo cáo **chưa nhắc** — đưa vào để được điểm cộng và để giọng văn "có chất người làm thật":

| Chi tiết | Vị trí code | Nên đưa vào |
|---|---|---|
| Chống timing attack: luôn `bcrypt.compare` với `DUMMY_HASH` kể cả khi username sai | `auth.js:14,97` | Mục 4.2.1 hoặc 4.7 |
| `$transaction` khi đăng ký để chống race condition giữa check whitelist và update `usedAt` | `auth.js:66-75` | Mục 4.2.1 |
| Xóa khóa nhạy cảm (`DH1..DH4`, `IK_priv`, `EK.priv`, `OPK_priv`) khỏi RAM ngay sau khi tính SK | `x3dh.js:84-86, 125-127` | Mục 3.5.3 hoặc 4.2.2 |

---

## 3. Góp ý giọng văn — viết như người, không như AI

> Nhận xét thẳng: văn của em **trau chuốt, đúng chuẩn học thuật**, nhưng đọc **"mượt đều" kiểu AI**. Không bị trừ điểm trực tiếp, nhưng khi bảo vệ hội đồng sẽ thử xem em có thực sự hiểu. Dưới đây là cách "người hóa" lại.

### 3.1. Các "dấu vân tay AI" cần giảm

1. **Lạm dụng tam đoạn cân đối**: "Trước tiên... Tiếp đến... Cuối cùng", "Thứ nhất... Thứ hai... Thứ ba" lặp gần như mọi đoạn. → Phá nhịp: đôi chỗ dùng 2 ý, đôi chỗ 4 ý, hoặc viết liền mạch.
2. **Dấu gạch ngang dài "—" dày đặc**. → Giảm còn ~1/3, thay bằng dấu phẩy, ngoặc đơn, hoặc tách câu.
3. **Mô-típ "đánh đổi X lấy Y", "thẳng thắn nêu", câu nào cũng cân hai vế**. → Cho phép vài câu "lệch", câu ngắn dứt khoát.
4. **Thiếu dấu vết cá nhân**: không có "tôi", không có quyết định/khó khăn cụ thể khi làm. → Đây là thứ AI khó bịa, và là thứ làm báo cáo "thật".

### 3.2. Công thức "người hóa" một đoạn

Chèn thêm 3 loại câu mà chỉ người làm thật mới viết được:

- **Câu quyết định cá nhân:** *"Tôi chọn 600.000 vòng PBKDF2 theo khuyến nghị OWASP 2023, sau khi cân nhắc giữa độ trễ đăng nhập (~0,5s) và khả năng chống brute-force."*
- **Câu khó khăn/bài học:** *"Trong quá trình cài đặt X3DH, tôi mất khá nhiều thời gian ở bước convert khóa Ed25519 sang X25519, vì nếu dùng nhầm định dạng khóa thì hai bên dẫn xuất ra Session Key khác nhau mà không có lỗi rõ ràng."*
- **Câu lý do thiết kế cụ thể:** *"Tôi cố tình không lưu metadata file vào cơ sở dữ liệu mà nhúng vào payload đã mã hóa, để máy chủ không suy ra được tên hay loại tệp."*

### 3.3. Ví dụ viết lại (Before → After)

**Before (giọng AI, mục 4.2.2):**
> "Đây là module trọng tâm, được triển khai hoàn toàn phía client bằng thư viện libsodium-wrappers cho các phép toán trên Curve25519 và Web Crypto API cho AES-GCM, HKDF và PBKDF2."

**After (giọng người):**
> "Module này là phần tôi đầu tư nhiều công sức nhất. Tôi đặt toàn bộ thao tác mật mã ở phía client: libsodium-wrappers lo phần Curve25519, còn AES-GCM, HKDF và PBKDF2 thì dùng Web Crypto API có sẵn trong trình duyệt để tránh kéo thêm thư viện. Một chỗ tôi phải xử lý cẩn thận là khóa định danh: tôi sinh nó dưới dạng Ed25519 để ký SPK, nhưng khi chạy bốn phép Diffie-Hellman lại phải convert sang X25519 — nếu để lẫn hai định dạng thì hai bên ra Session Key khác nhau."

### 3.4. Nguyên tắc khi sửa giọng văn

- **Giữ** thuật ngữ kỹ thuật chính xác (đừng "người hóa" đến mức sai).
- **Mỗi mục lớn** chèn ít nhất 1 câu có "tôi" + 1 chi tiết cụ thể.
- **Đa dạng độ dài câu**: xen câu ngắn (5–8 từ) giữa các câu dài.
- **Đừng sửa đồng loạt bằng find-replace** — đọc lại to thành tiếng từng đoạn, chỗ nào nghe như đọc diễn văn thì viết lại.
- Phần **Lời cảm ơn, Hạn chế, Kết luận** là nơi giọng cá nhân tự nhiên nhất — ưu tiên người hóa ở đó trước.

---

## 4. Checklist trước khi nộp

**Phải sửa (🔴):**
- [ ] ① Đổi tất cả "10MB" → "5MB" (kèm giải thích 7MB ở backend)
- [ ] ② Sửa pseudocode fingerprint (3.5.5 + Phụ lục D.6): bỏ `‖ pub` trong vòng lặp
- [ ] ③ Sửa mục 2.3.7 (bỏ "và định danh người dùng" HOẶC sửa code thêm userId)
- [ ] ④ Tách luồng register / upload key (Bảng 3.2 + Hình 3.6)
- [ ] ⑤ Sửa vai trò Redis ở mục 4.5
- [ ] ⑥ Vẽ lại ERD (UploadedFile + adminId của Group)
- [ ] ⑦ Sửa lý giải "va chạm" ở mục 3.5.5

**Nên sửa (🟡):**
- [ ] ⑧ Pseudocode 3.5.1: IK là Ed25519
- [ ] ⑨ Pseudocode 3.5.3: thêm tiền tố F
- [ ] ⑩ Đồng bộ mô tả "5 container" giữa 1.3.2 và 4.5
- [ ] ⑪ Sửa mô tả AAD ở mục 2.3.5

**Nên bổ sung (🟢):**
- [ ] ⑫ Thêm hạn chế Redis fail-open vào 5.2
- [ ] ⑬ Thêm mô tả ADMIN_SEED_EMAIL
- [ ] ⑭ Bổ sung phương pháp đo + benchmark throughput (4.6)
- [ ] ⑮ Đưa 3 điểm tốt của code (timing attack, transaction, xóa key RAM) vào báo cáo

**Giọng văn:**
- [ ] Giảm gạch ngang dài, phá nhịp tam đoạn
- [ ] Mỗi chương lớn chèn ≥1 câu "tôi" + chi tiết cụ thể
- [ ] Người hóa kỹ phần Lời cảm ơn / Hạn chế / Kết luận
- [ ] Đọc to thành tiếng để bắt đoạn "nghe như AI"

---

*Ghi chú: mọi tham chiếu `file:line` ở trên lấy từ mã nguồn tại thời điểm rà soát. Nếu em sửa code (ví dụ theo Hướng B ở mục ③), nhớ cập nhật lại số dòng tương ứng trong báo cáo và phụ lục.*
