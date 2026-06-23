# Rà soát báo cáo đồ án tốt nghiệp — Danh sách lỗi và cách sửa

> **Tài liệu này dùng để giao cho AI sửa file báo cáo.**
> Báo cáo: *"Xây dựng ứng dụng Web nhắn tin bảo mật tích hợp mã hóa đầu cuối"* — Đặng Nguyên Giáp, ĐHBK Hà Nội, 06/2026.
> Hệ thống: E2EE chat, mô hình Blind Server (server chỉ thấy ciphertext + public key + metadata).
> Stack: React + libsodium + Web Crypto (client); Node/Express + ws + PostgreSQL 16 + Prisma + Redis (server); Docker Compose + Nginx + Cloudflare Tunnel.
>
> **Nguyên tắc khi sửa:** chỉ sửa đúng các mục dưới đây, KHÔNG đổi nội dung kỹ thuật đã đúng, giữ nguyên văn phong học thuật tiếng Việt. Sau khi sửa xong phải **update toàn bộ mục lục / danh mục hình / danh mục bảng / cross-reference** (bôi đen cả tài liệu → F9 → Update entire table) rồi mới xuất PDF.

---

## A. LỖI TRÌNH BÀY — BẮT BUỘC SỬA (lộ ngay khi lật trang)

### A1. Mục lục còn lỗi "Error! Bookmark not defined." (trang 9)
Hai dòng sau trong MỤC LỤC đang hiển thị lỗi:
- `PHỤ LỤC B. ĐẶC TẢ CÁC USE CASE CÒN LẠI ....... Error! Bookmark not defined.`
- `PHỤ LỤC C. CÁC TRƯỜNG HỢP KIỂM THỬ ........... Error! Bookmark not defined.`

**Cách sửa:**
1. Gắn lại bookmark/heading đúng cho các phụ lục bị mất tham chiếu.
2. Update lại toàn bộ Mục lục (F9). Sau khi update, hai dòng này phải hiển thị đúng số trang, không còn chữ "Error!".

### A2. Đánh số Phụ lục mâu thuẫn giữa mục lục, thân bài và tiêu đề phụ lục
Hiện trạng mâu thuẫn:
- Mục lục (trang 9) liệt kê: Phụ lục A, **B = use case còn lại**, **C = kiểm thử**, **D = mã nguồn**.
- Thân bài trang 39: *"Các use case còn lại được đặc tả đầy đủ trong **Phụ lục B**"* — NHƯNG thực tế các use case 3.8–3.17 lại **nằm trong thân bài** (trang 44–49), không nằm ở phụ lục.
- Thân bài trang 49: *"Mã nguồn... đặt trong **Phụ lục D**"* — NHƯNG phụ lục mã nguồn lại đang mang tiêu đề **"PHỤ LỤC B. MÃ NGUỒN CÁC HÀM MẬT MÃ CỐT LÕI"** (trang 78).

**Cách sửa (chọn phương án thống nhất theo mục lục):**
1. Đổi tiêu đề phụ lục mã nguồn ở trang 78 từ `PHỤ LỤC B. MÃ NGUỒN...` → **`PHỤ LỤC D. MÃ NGUỒN CÁC HÀM MẬT MÃ CỐT LÕI`**.
2. Sửa câu ở trang 39: vì 16 use case đã được đặc tả ĐẦY ĐỦ ngay trong thân bài (Bảng 3.2–3.17), nên **bỏ câu** *"Các use case còn lại được đặc tả đầy đủ trong Phụ lục B"* hoặc đổi thành: *"Sáu use case quan trọng nhất được đặc tả chi tiết dưới đây; các use case còn lại được đặc tả trong các Bảng 3.8–3.17."*
3. Nếu mục lục vẫn còn dòng "PHỤ LỤC B. ĐẶC TẢ CÁC USE CASE CÒN LẠI" và "PHỤ LỤC C. CÁC TRƯỜNG HỢP KIỂM THỬ" nhưng nội dung 2 phụ lục này KHÔNG tồn tại trong tài liệu → **xóa 2 dòng đó khỏi mục lục**, hoặc tạo thật 2 phụ lục đó. (Khuyến nghị: xóa cho gọn, vì use case đã nằm ở thân bài và bảng kiểm thử TC-01..TC-08 đã nằm ở mục 4.4.2.)

### A3. Lỗi đánh số BẢNG (nghiêm trọng, lặp ở nhiều trang)
**Lỗi 3a — Bảng "Ranh giới dữ liệu máy chủ lưu/không lưu" bị gọi 3 tên khác nhau:**
- Danh mục bảng (trang 11) gọi: **Bảng 3.18**
- Caption trong thân bài (trang 59) ghi: **Bảng 3.8**
- Tham chiếu trong văn: trang 25 ghi *"xem Bảng 3.18"*, trang 71 ghi *"Bảng 3.8 đã làm rõ..."*

→ **Cách sửa:** thống nhất MỘT số duy nhất. Vì các bảng đặc tả use case đã chiếm số 3.2–3.17, bảng ranh giới dữ liệu nên là **Bảng 3.18**. Sửa caption trang 59 từ "Bảng 3.8" → **"Bảng 3.18"**, và sửa câu trang 71 từ "Bảng 3.8" → **"Bảng 3.18"**. (Kiểm tra: không được để tồn tại đồng thời hai "Bảng 3.8".)

**Lỗi 3b — Danh mục bảng (trang 11) thiếu Bảng 3.8 → 3.17:**
Danh mục bảng nhảy từ Bảng 3.7 thẳng sang 3.18, bỏ sót 10 bảng đặc tả use case (Đăng xuất, Bắt đầu trò chuyện, Tạo nhóm, Xem cuộc trò chuyện, Xóa tin nhắn, Xóa hội thoại, Rời nhóm, Xuất khóa, Quản lý người dùng, Quản lý whitelist email).
→ **Cách sửa:** bổ sung đầy đủ Bảng 3.8–3.17 vào Danh mục bảng (hoặc update field tự sinh lại).

**Lỗi 3c — Số trang trong Danh mục bảng/hình sai hệ thống:**
Ví dụ Bảng 4.1 ghi trang 57 (thực tế trang 70); Bảng 3.18 ghi trang 47 (thực tế trang 59); Bảng 2.1 ghi 29 (thực tế 30–31).
→ **Cách sửa:** đây là hệ quả của việc chưa update field. Update toàn bộ Danh mục bảng và Danh mục hình (F9).

### A4. Lỗi lệnh trong Phụ lục A (trang 77)
Lệnh hiện tại:
```
docker compose exec app npx prisma migrate deploy
```
Service trong docker-compose tên là **`backend`**, KHÔNG phải `app`. Chạy lệnh này sẽ lỗi "no such service: app".
→ **Cách sửa:** đổi `app` → **`backend`**:
```
docker compose exec backend npx prisma migrate deploy
```

### A5. Caption bị dính số chú thích (toàn tài liệu)
Nhiều caption hình/bảng bị dính 1 chữ số ở cuối do superscript/footnote nhập sai vào caption, ví dụ:
- "Hình 3.1: Biểu đồ use case tổng quát của hệ thống**5**"
- "Bảng 3.1: Ánh xạ giữa bốn module và các chức năng chính**2**"
- "Hình 2.3: Nguyên lý kết hợp bốn phép Diffie-Hellman trong X3DH**4**"

→ **Cách sửa:** rà toàn bộ caption Hình/Bảng, xóa chữ số thừa dính ở cuối tiêu đề.

---

## B. LỖI/THIẾU NHẤT QUÁN VỀ KỸ THUẬT (GV mật mã sẽ soi)

### B1. Mã nguồn Phụ lục D.3/D.4 thiếu tiền tố F so với đặc tả
- Trang 27 và pseudocode trang 53 ghi rõ: `IKM = F || DH1 || DH2 || DH3 || DH4` với `F = 0xFF` lặp 32 byte (tổng 160 byte), `SK = HKDF-SHA256(IKM, salt = 0x00×32, info = "E2EEChat_v1")`.
- NHƯNG code Phụ lục D.3 (người gửi) và D.4 (người nhận) lại là `const ikm = concat(DH1, DH2, DH3, DH4);` — **thiếu F**, và `hkdfSha256(ikm, 32)` không thể hiện `salt`/`info`.

→ **Cách sửa:** sửa code phụ lục cho khớp đặc tả, ví dụ:
```js
const F = new Uint8Array(32).fill(0xFF);
const ikm = concat(F, DH1, DH2, DH3, DH4);
const SK = await hkdfSha256(ikm, 32, /*salt*/ new Uint8Array(32), /*info*/ 'E2EEChat_v1');
```
(Hoặc nếu giữ code rút gọn thì thêm chú thích: *"đã lược bỏ tiền tố F và tham số salt/info để làm nổi bật logic; bản đầy đủ theo mục 2.3.3"*.)

### B2. Phụ lục D bỏ qua chuyển đổi Ed25519 → X25519
Trang 25 và 66 nhấn mạnh rất hay về bug "để lẫn Ed25519 và X25519". Nhưng code D.3 dùng thẳng `myIK.privateKey` (Ed25519) trong `crypto_scalarmult` (vốn cần X25519). Phụ lục D tự nhận là *"mã nguồn cốt lõi phía client"* nên mâu thuẫn với phần thân bài.
→ **Cách sửa:** thêm bước chuyển đổi trong code phụ lục (hoặc ghi chú rõ là rút gọn):
```js
const ikX = sodium.crypto_sign_ed25519_sk_to_curve25519(myIK.privateKey);
const DH1 = dh(ikX, bundleB.SPK_pub);
```

### B3. Tên Module 4.2.4 gây hiểu nhầm
Tiêu đề "Module xử lý **hàng đợi** tin nhắn" nhưng câu đầu (trang 66) ghi *"Hệ thống **không dùng hàng đợi** riêng"*.
→ **Cách sửa:** đổi tên thành **"Module truyền tin thời gian thực (store-and-forward)"**, hoặc giữ tên theo phiếu nhiệm vụ nhưng thêm câu giải thích: *"Tên gọi 'hàng đợi' phản ánh vai trò lưu-đệm-rồi-chuyển-tiếp; hệ thống hiện thực bằng cơ chế store-and-forward trên PostgreSQL thay vì một message queue riêng."*

### B4. Thiếu trích dẫn cho bcrypt
Hệ thống dùng bcrypt cost 12 nhưng phần Tài liệu tham khảo không có nguồn cho bcrypt (trong khi PBKDF2 có OWASP, HKDF có RFC...).
→ **Cách sửa:** thêm 1 mục tham khảo cho bcrypt (ví dụ Provos & Mazières, "A Future-Adaptable Password Scheme", USENIX 1999) hoặc OWASP Password Storage Cheat Sheet.

---

## C. PHẦN SƠ SÀI — NÊN BỔ SUNG

### C1. Mục 4.3 "Minh họa chức năng" gần như trống (trang 67) — ƯU TIÊN CAO
Cả mục chỉ trỏ về wireframe (Hình 3.13–3.16), mà mục 3.8 đã nói rõ wireframe **không phải ảnh chụp màn hình sản phẩm**. Một đồ án "sản phẩm chạy thật" mà không có ảnh demo thật là điểm yếu lớn.
→ **Cách sửa:** chèn 4–6 **ảnh chụp màn hình THẬT** kèm chú thích, tối thiểu:
1. Màn đăng ký + thông báo sinh khóa / nhắc xuất file .e2ee.
2. Màn chat thật giữa 2 trình duyệt (2 người dùng).
3. Hộp thoại đối chiếu Fingerprint khớp (60 chữ số).
4. Trang quản trị (danh sách user + whitelist).
5. **Ảnh DB chỉ chứa ciphertext** (chứng minh Blind Server trực quan).

### C2. Tính năng gửi file/ảnh E2EE bị bỏ lửng
Scope + abstract nói có gửi file (≤5MB), ERD có `UploadedFile`, nhưng Chương 4 không có module nào mô tả luồng mã hóa file, cũng không có sơ đồ tuần tự.
→ **Cách sửa:** thêm 1 đoạn ngắn (trong 4.2) mô tả: file được mã hóa AES-256-GCM ngay tại client bằng khóa phiên; tên tệp/MIME/kích thước được nhúng trong payload đã mã hóa (nhất quán mục 3.6); giới hạn 5MB client / 7MB server để bù overhead mã hóa.

### C3. Benchmark (4.6) thiếu ngữ cảnh tải
Có "194 tin/s, 40 login/s" nhưng không nêu số kết nối đồng thời (VUs) của k6, không có p95/p99.
→ **Cách sửa:** thêm 1 câu nêu cấu hình k6 (số VUs, thời lượng) và nếu có thì bổ sung p95 độ trễ.

---

## D. BỔ SUNG TÍNH NĂNG SAO LƯU (BACKUP) — vị trí và nội dung

> Tính năng này lấp đúng lỗ hổng trong mục 3.2.2 "tính sẵn sàng" (trang 33) — vốn chỉ nói đệm tin offline, chưa nói khôi phục dữ liệu khi sự cố. Hệ thống đã triển khai service `pg-backup` (chạy `pg_dump` định kỳ, nén gzip, rolling retention) và script khôi phục 1 lệnh.

### D1. Thêm mục **4.5.1 "Sao lưu và khôi phục dữ liệu"** (trong 4.5 Triển khai) — CHỖ CHÍNH
Nội dung cần có:
- Persistence bằng Docker named volume (`postgres_data`) đảm bảo dữ liệu không mất khi restart.
- Service `pg-backup` (cùng image `postgres:16-alpine`) chạy vòng lặp `pg_dump → gzip → lưu file timestamp → tự xóa bản cũ`, theo chính sách giữ N bản gần nhất (rolling retention); mỗi bản là **full snapshot** của toàn bộ DB.
- **Điểm nhấn ăn điểm (liên hệ Bảng 3.18):** nhờ mô hình máy chủ mù, file backup chỉ chứa ciphertext + public key + metadata → an toàn ngay cả khi rò rỉ, khác hẳn backup plaintext của hệ chat thường.
- Khôi phục bằng một lệnh, đã kiểm chứng restore đúng (dữ liệu tin nhắn/người dùng phục hồi đầy đủ).
- **Đặc tính E2EE:** restore chỉ trả lại ciphertext; người dùng vẫn đọc được tin cũ nếu private key trong IndexedDB còn; mất private key thì không khôi phục được lịch sử — trade-off cố hữu của E2EE, không phải lỗi backup.

### D2. ⚠️ Sửa nhất quán số container: "năm" → "sáu"
Việc thêm service `pg-backup` làm tăng số container từ 5 lên 6. Phải sửa ĐỒNG LOẠT mọi chỗ nói "năm container":
- Trang 18 (mục 1.3.2): *"đóng gói thành năm container Docker..."*
- Trang 69 (mục 4.5): *"Hệ thống gồm năm dịch vụ..."* và danh sách "(i)...(v)".
- Phụ lục A (trang 77): *"...dựng năm container..."* và comment `# dựng 5 container`.

→ Đổi "năm" → **"sáu"**, bổ sung mục `(vi) pg-backup: sao lưu PostgreSQL định kỳ ra thư mục backups`. (Nếu KHÔNG muốn đụng nhiều chỗ, có thể trình bày `pg-backup` như một dịch vụ phụ trợ tùy chọn và giữ nguyên "năm dịch vụ cốt lõi" + 1 câu nói thêm — nhưng phải nhất quán.)

### D3. Phụ lục A — thêm lệnh backup/restore vào quy trình
Bổ sung sau bước migrate:
```
# Sao lưu thủ công khi cần (ngoài lịch tự động):
docker compose exec pg-backup ls -lh /backups

# Khôi phục từ backup (PowerShell, Windows):
.\restore.ps1                       # dùng bản backup mới nhất
.\restore.ps1 <ten_file>.sql.gz     # dùng bản chỉ định
```

### D4. Chương 5 — cập nhật cân đối
- **5.2 Hạn chế (nhóm vận hành):** thêm ý: *"backup hiện lưu cùng host, chưa đẩy off-site; chưa có chính sách lưu trữ phân tầng (GFS) để khôi phục về các mốc thời gian xa."*
- **5.3 Hướng phát triển (nhóm vận hành):** thêm ý: *"đẩy backup lên lưu trữ ngoài (S3/máy khác), áp dụng chính sách GFS (daily/weekly/monthly), và mã hóa file backup."*

---

## CHECKLIST RÀ SOÁT CUỐI (đánh dấu khi xong)

- [ ] A1: Hết lỗi "Error! Bookmark not defined." trong mục lục
- [ ] A2: Tiêu đề phụ lục mã nguồn = "PHỤ LỤC D"; câu trang 39 sửa/bỏ; mục lục phụ lục khớp nội dung
- [ ] A3a: Bảng ranh giới dữ liệu chỉ còn MỘT số (3.18) ở mọi nơi (trang 25, 59, 71, danh mục bảng)
- [ ] A3b: Danh mục bảng có đủ Bảng 3.8–3.17
- [ ] A3c: Số trang trong danh mục hình/bảng đã update đúng (F9)
- [ ] A4: Phụ lục A đổi `exec app` → `exec backend`
- [ ] A5: Xóa hết chữ số thừa dính cuối caption Hình/Bảng
- [ ] B1: Code Phụ lục D.3/D.4 có tiền tố F + salt/info (hoặc ghi chú rút gọn)
- [ ] B2: Code Phụ lục D có bước Ed25519→X25519 (hoặc ghi chú)
- [ ] B3: Tên/giải thích Module 4.2.4 không còn mâu thuẫn "hàng đợi"
- [ ] B4: Thêm trích dẫn bcrypt
- [ ] C1: Thêm ảnh chụp màn hình thật vào mục 4.3
- [ ] C2: Thêm đoạn mô tả luồng mã hóa file ở 4.2
- [ ] C3: Thêm ngữ cảnh tải (VUs/p95) cho benchmark 4.6
- [ ] D1: Thêm mục 4.5.1 Sao lưu và khôi phục
- [ ] D2: Sửa "năm container" → "sáu" ở trang 18, 69, Phụ lục A
- [ ] D3: Thêm lệnh backup/restore vào Phụ lục A
- [ ] D4: Cập nhật 5.2 Hạn chế và 5.3 Hướng phát triển về backup
- [ ] CUỐI CÙNG: Update toàn bộ field (F9: mục lục, danh mục hình, danh mục bảng, cross-reference) rồi xuất PDF
