# Hướng dẫn sửa Chương 3 — Phân tích và Thiết kế hệ thống

> Tài liệu tập trung riêng cho **Chương 3**, đi theo từng mục 3.2 → 3.9.
> Mọi đề xuất đã đối chiếu mã nguồn thật (có ghi `file:line`).
>
> Quy ước: 🔴 phải sửa (sai sự thật / mâu thuẫn code) · 🟡 nên sửa (đồng bộ) · 🟢 nên bổ sung.
>
> Chương 3 là chương **lệch nhiều nhất** so với code — đặc biệt pseudocode (3.5), ERD và Bảng 3.8 (3.6).

---

## 3.4 — Đặc tả use case

### 🔴 Bảng 3.2 (Đăng ký) — luồng gửi khóa SAI
Bước 4 hiện tả: trình duyệt gửi `POST /auth/register` **kèm gói khóa công khai** (IK, SPK, chữ ký, OPK).

**Thực tế trong code:**
1. `POST /auth/register` **chỉ** tạo tài khoản (username, email, password) — KHÔNG nhận khóa (`auth.js:17-83`).
2. Khóa công khai được tải lên **riêng** bằng `POST /keys/upload`, **có `requireAuth`** — tức là *sau khi đã đăng nhập có JWT* (`keys.js:16-34`).

**Sửa Bảng 3.2 — tách bước 4 thành 2 bước:**
> 4. Trình duyệt gửi `POST /auth/register` chỉ gồm thông tin tài khoản (username, email, mật khẩu); mật khẩu được băm bằng bcrypt phía máy chủ.
> 5. Sau khi đăng nhập và nhận JWT, trình duyệt gọi `POST /keys/upload` để tải gói khóa công khai (IK, SPK, chữ ký SPK, danh sách OPK) lên máy chủ.

> ⚠️ Sửa kèm **Hình 3.6** (sơ đồ tuần tự Đăng ký): hiện vẽ "POST /auth/register (chỉ public key bundle)" — phải tách thành 2 nhịp: đăng ký tài khoản, rồi upload key sau khi có token.

**Vì sao quan trọng:** giám khảo dễ hỏi *"khi chưa đăng nhập (chưa có token) thì upload key kiểu gì?"* — nếu báo cáo gộp 1 bước là lộ ngay.

---

## 3.5 — Thiết kế hành vi động và thuật toán mật mã  (mục lệch nhiều nhất)

### 🟡 3.5.1 — Pseudocode ghi sai loại khóa IK
Hiện ghi `IK = X25519.generateKeyPair()`. Thực tế IK là **Ed25519** (`keyGen.js:21` dùng `crypto_sign_keypair`), khi cần DH mới convert sang X25519 (`x3dh.js:66`). **Phụ lục D.1 đã ghi đúng "Ed25519"** → đang **mâu thuẫn ngay trong báo cáo**.

**Sửa pseudocode 3.5.1:**
```
IK  = Ed25519.generateKeyPair()    // khóa định danh — dùng để KÝ
SPK = X25519.generateKeyPair()     // khóa ký trước — dùng để DH
sig = Ed25519.sign(IK.priv, SPK.pub)
OPK = [ X25519.generateKeyPair() × 100 ]
// Khi chạy X3DH: convert IK (Ed25519) → X25519 mới tính được Diffie-Hellman
```

### 🟡 3.5.3 — Pseudocode X3DH thiếu tiền tố F
Code ghép IKM có **tiền tố `F = 0xFF × 32`** trước 4 DH (`x3dh.js:76-77`), và Hình 2.3 cũng vẽ F — nhưng pseudocode 3.5.3 lại bỏ. Thêm vào cho khớp:
```
F   = 0xFF lặp 32 byte               // phân biệt X25519/X448 theo Signal spec
IKM = F || DH1 || DH2 || DH3 || DH4  // = 160 byte
SK  = HKDF-SHA256(IKM, salt = 0x00×32, info = "E2EEChat_v1")
```
(Có thể ghi rõ thêm: HKDF dùng `salt = 32 byte 0x00`, `info = "E2EEChat_v1"` để domain separation — `x3dh.js:24-26`.)

### 🔴 3.5.5 — Pseudocode Fingerprint SAI vòng lặp
Pseudocode hiện (và Phụ lục D.6) ghi `h = SHA-512(h || pub)` — **nối lại `pub` mỗi vòng**. Code thật **chỉ băm chính giá trị hash trước đó**, KHÔNG nối pub (`fingerprint.js:20-23`):
```js
let hash = await crypto.subtle.digest('SHA-512', combined);
for (let i = 0; i < 5199; i++) hash = await crypto.subtle.digest('SHA-512', hash);
```
**Sửa pseudocode thành:**
```
function safetyNumber(IK_pub_A, IK_pub_B):
    pair = sortLexicographically(IK_pub_A, IK_pub_B)   // để 2 bên ra cùng kết quả
    h    = SHA-512(pair)                               // pair = 64 byte (2 khóa nối)
    repeat 5199 times: h = SHA-512(h)                  // CHỈ băm h, KHÔNG nối pub
    return ( bigint(h) mod 10^60 )                     // 60 chữ số thập phân
```
> Con số 5200 vẫn đúng (1 lần đầu + 5199 lần lặp). Chỉ sai công thức bên trong.

### 🔴 3.5.5 — Lý giải "va chạm" SAI về mật mã
Câu hiện tại: *"Việc lặp băm làm tăng chi phí tính toán cho kẻ tấn công muốn tạo va chạm"* — **sai**. Lặp băm KHÔNG tăng kháng va chạm của SHA-512.

**Sửa lại (đúng):**
> "Việc lặp băm 5200 vòng khiến mỗi lần thử của kẻ tấn công — muốn tạo một khóa giả sao cho chuỗi 60 chữ số rút gọn vẫn trùng với chuỗi của nạn nhân — trở nên tốn kém hơn đáng kể, trong khi vẫn đủ nhanh để người dùng tính một lần khi xác minh."

> 🟡 Đồng bộ với Chương 2 (mục 2.3.7): chỗ đó nói fingerprint sinh từ "khóa định danh **và định danh người dùng**", nhưng code chỉ dùng **2 khóa IK_pub** (không có userId). Sửa câu ở 2.3.7 cho khớp (xem hướng dẫn tổng ③).

---

## 3.6 — Thiết kế cơ sở dữ liệu  (có 2 lỗi 🔴)

### 🔴 Bảng 3.8 — "Khóa bọc PBKDF2" đặt nhầm vào cột "Máy chủ LƯU"
Bảng 3.8 đang liệt kê **"Khóa bọc dẫn xuất từ mật khẩu (PBKDF2)"** ở cột **Máy chủ LƯU**. Đây là lỗi **nghiêm trọng về mặt mô hình bảo mật**, vì:
- Khóa riêng đã bọc (`wrappedIK/SPK/OPK`) + `wrapSalt` nằm trong **IndexedDB phía client** (`storage.js:46-52`).
- Server (`KeyBundle`) **chỉ** lưu khóa công khai: `ikPub, spkPub, spkSig, opkPubs` (`keys.js:32-34`, `schema.prisma:38-47`).
- Bản thân *wrapping key* (dẫn xuất PBKDF2) **không được lưu ở đâu cả** — nó được derive lại từ mật khẩu mỗi lần cần.

**Sửa Bảng 3.8:**
- **Xóa** dòng "Khóa bọc dẫn xuất từ mật khẩu (PBKDF2)" khỏi cột *Máy chủ LƯU*.
- (Tùy chọn) thêm một câu dưới bảng: *"Khóa riêng đã bọc và salt PBKDF2 được lưu trong IndexedDB của trình duyệt, hoàn toàn không gửi lên máy chủ — đúng với mô hình máy chủ mù."*

> Nếu để nguyên, giám khảo có thể bắt: "nếu server giữ khóa dẫn xuất từ mật khẩu thì còn gì là máy chủ mù?".

### 🔴 Hình 3.11 (ERD) — sai thuộc tính
- `UploadedFile`: hình vẽ ghi `storedName, mimeType, size` — **không tồn tại**. Model thật chỉ có `id, uploaderId, createdAt` (`schema.prisma:103-108`). Tên/kiểu/kích thước file nằm trong **payload tin nhắn đã mã hóa**, không lưu DB → đây là **điểm cộng bảo mật**, nên nói rõ.
- `Group`: hình thiếu trường `adminId` (model có — dùng để chuyển quyền admin, `schema.prisma:71`).

**Cách sửa:** vẽ lại `UploadedFile` chỉ còn `{id, uploaderId, createdAt}`; thêm `adminId` vào `Group`; thêm câu giải thích metadata file không lưu DB.

### 🟢 Bổ sung về chống replay ở tầng DB
Báo cáo mới nhắc OPK có ràng buộc duy nhất. Nên bổ sung: tin nhắn cũng có **ràng buộc duy nhất `@@unique([conversationId, iv])`** (và `@@unique([groupId, recipientId, iv])`) để chống phát lại (`schema.prisma:147-148`) — khi gửi lại bản mã cũ, server trả HTTP 409.

---

## 3.7 — Thiết kế kiến trúc phần mềm

**Giữ nguyên (đúng):** biểu đồ gói (Hình 3.12) khớp cấu trúc thật — frontend có `crypto / db / services / components / pages / hooks / contexts`; backend có `routes / ws / middleware / prisma / redis`.

**🟡 Một câu nên chỉnh:** ở phần mô tả tầng backend, nếu có nói Redis dùng cho hàng đợi → sửa thành **"Redis chỉ giữ danh sách thu hồi JWT"**, nhất quán với code (xem hướng dẫn Chương 4, mục 4.5).

---

## 3.2 / 3.3 / 3.8 — Các mục còn lại (ít lỗi)

- **3.2 (Yêu cầu):** nếu có ghi file "10MB" → đổi thành **5MB** (đồng bộ toàn báo cáo).
- **3.3 (Use case):** biểu đồ và quan hệ include/extend hợp lý; báo cáo đã tự ghi chú "include Xác minh danh tính là đơn giản hóa có chủ đích" — chấp nhận được, giữ nguyên.
- **3.8 (Giao diện):** wireframe mô tả đúng, không cần sửa về kỹ thuật.

---

## Tổng kết việc cần làm ở Chương 3

**🔴 Phải sửa:**
- [ ] Bảng 3.2 + Hình 3.6: tách đăng ký tài khoản ↔ upload khóa (2 bước)
- [ ] 3.5.5: sửa pseudocode fingerprint (bỏ `|| pub` trong vòng lặp)
- [ ] 3.5.5: sửa lý giải "va chạm" cho đúng mật mã
- [ ] Bảng 3.8: bỏ "Khóa bọc PBKDF2" khỏi cột *Máy chủ LƯU*
- [ ] Hình 3.11 (ERD): sửa `UploadedFile` + thêm `adminId` cho `Group`

**🟡 Nên sửa (đồng bộ):**
- [ ] 3.5.1: IK là Ed25519 (không phải X25519)
- [ ] 3.5.3: thêm tiền tố `F = 0xFF×32` + chi tiết HKDF salt/info
- [ ] 3.7: Redis chỉ là blocklist JWT

**🟢 Nên bổ sung:**
- [ ] 3.6: ràng buộc `@@unique(conversationId, iv)` chống replay
- [ ] 3.6: câu nói rõ khóa riêng đã bọc nằm ở IndexedDB client, metadata file không lưu DB

**Về giọng văn cho Chương 3:**
Chương 3 nặng tính kỹ thuật nên dễ "khô" và "đều" kiểu AI. Cách người-hóa: khi giải thích một quyết định thiết kế, thêm 1 câu lý do *của em* — ví dụ ở 3.6: *"Tôi cố ý không lưu tên và kích thước file vào cơ sở dữ liệu mà nhúng vào payload đã mã hóa, để ngay cả metadata cũng không tiết lộ cho máy chủ."* Những câu kiểu này vừa đúng code, vừa cho thấy người thật ra quyết định.
