# Tổng hợp câu hỏi & trả lời — Auth System (bcrypt, JWT, Redis)

---

## PHẦN 1 — BCRYPT

### Câu 1: `BCRYPT_ROUNDS = 12` nghĩa là gì, tại sao chọn 12?

`BCRYPT_ROUNDS` là tham số cost factor dùng trong thuật toán bcrypt. Hàm sẽ chạy `2^12 = 4096` vòng lặp bên trong EksBlowfishSetup, mất khoảng ~300ms.

- Nếu chọn nhỏ hơn (ví dụ 6): nhanh hơn nhưng dễ bị brute force hơn
- Nếu chọn lớn hơn (ví dụ 20): quá chậm, user chờ đăng nhập rất lâu
- OWASP khuyến nghị tối thiểu cost=10, chọn 12 là cân bằng tốt giữa bảo mật và trải nghiệm

---

### Câu 2: Tại sao không dùng MD5 hay SHA256 để hash password?

MD5 và SHA256 được thiết kế để chạy **nhanh nhất có thể** — dùng cho checksum file, TLS, không phải cho password.

- Không có salt mặc định → cùng password ra cùng hash → dễ bị **rainbow table attack**
- GPU hiện đại thử được **60 tỷ MD5/giây**, trong khi bcrypt cost=12 chỉ được **~300 hash/giây**
- Brute force password 8 ký tự với MD5: vài phút. Với bcrypt: hàng trăm năm

---

### Câu 3: `bcrypt.hash()` và `bcrypt.compare()` khác nhau thế nào, tại sao không có `bcrypt.decrypt()`?

**`bcrypt.hash(password, rounds)`:**
- Sinh salt ngẫu nhiên 128-bit
- Hash password cùng salt qua 4096 vòng lặp
- Trả về chuỗi 60 ký tự chứa version + cost + salt + hash
- Dùng khi **đăng ký** — lưu vào DB

**`bcrypt.compare(password, hash)`:**
- Đọc salt từ chuỗi hash đã lưu trong DB
- Hash lại password với đúng salt đó
- So sánh kết quả, trả về `true` hoặc `false`
- Dùng khi **đăng nhập**

**Không có `bcrypt.decrypt()`** vì bcrypt là hàm **một chiều** — không thể tính ngược từ hash ra password gốc, khác với mã hóa.

---

### Câu 4: Salt là gì, trong code có thấy truyền salt vào không, tại sao?

Salt là chuỗi **128-bit ngẫu nhiên** được sinh ra mỗi lần hash. Trong code không thấy truyền salt vào vì bcrypt **tự sinh ngầm bên trong** thư viện.

Salt được nhúng trực tiếp vào chuỗi hash kết quả (22 ký tự Base64) nên không cần lưu riêng ở đâu.

**Mục đích:** đảm bảo cùng một password sẽ ra hash **khác nhau mỗi lần** → vô hiệu hóa rainbow table attack.

```
bcrypt.hash("abc123", 12) → "$2b$12$saltA...hash1"
bcrypt.hash("abc123", 12) → "$2b$12$saltB...hash2"  ← khác nhau!
```

---

### Câu 5: Cấu trúc của một bcrypt hash trông như thế nào?

```
$2b$12$SomeRandomSaltHereXXXXXHashValueHereXXXXXXXXXXXXXXX
 ↑   ↑  ↑──── 22 ký tự ────↑  ↑──── 31 ký tự ────↑
ver cost      salt                    hash
```

- `$2b$` — version của bcrypt
- `$12$` — cost factor
- 22 ký tự — salt 128-bit encode Base64
- 31 ký tự — hash 184-bit encode Base64

---

### Câu 6: `DUMMY_HASH` dùng để làm gì, bỏ đi có sao không?

DUMMY_HASH là một bcrypt hash giả dùng để **chống timing attack**.

**Vấn đề nếu không có DUMMY_HASH:**
```
User không tồn tại → trả 401 ngay (~1ms)
User tồn tại nhưng sai password → chạy bcrypt rồi mới trả 401 (~300ms)
```

Hacker đo thời gian response → biết username nào tồn tại → **user enumeration attack** → tập trung brute force đúng username đó.

**Với DUMMY_HASH:**
```js
const hashToVerify = user ? user.passwordHash : DUMMY_HASH;
await bcrypt.compare(password, hashToVerify); // luôn tốn ~300ms
```

Mọi request đều tốn ~300ms → hacker không phân biệt được.

**Lưu ý:** DUMMY_HASH phải là hash bcrypt hợp lệ vì `bcrypt.compare()` với `undefined` sẽ throw error hoặc return ngay lập tức, lộ timing.

---

### Câu 7: Tại sao `if (!user || !valid)` gộp chung một điều kiện?

Để tránh **information disclosure** — nếu tách ra:
```js
if (!user) return res.status(401).json({ error: 'Username không tồn tại' });
if (!valid) return res.status(401).json({ error: 'Sai password' });
```

Hacker biết được sai username hay sai password → loại trừ bớt trường hợp → brute force hiệu quả hơn.

Gộp chung một thông báo "Sai username hoặc password" → hacker không biết mình sai ở đâu.

---

### Câu 8: Nếu 1000 request đăng ký cùng lúc thì sao?

Worker Thread Pool mặc định có 4 thread (có thể tăng lên 8 bằng `UV_THREADPOOL_SIZE=8`):

```
1000 request / 8 thread = 125 batch × 300ms = ~37 giây
```

**Giải pháp thực tế: Rate Limiting**

```js
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 10,                   // tối đa 10 lần / IP
  message: { error: 'Quá nhiều request, thử lại sau' }
});

router.post('/register', registerLimiter, async (req, res) => { ... });
```

1000 request từ một IP sẽ bị chặn từ request thứ 11 — không bao giờ chạm đến bcrypt.

---

### Câu 9: Cost factor 12 sau 5 năm có còn an toàn không, migrate như thế nào?

**Có thể không an toàn** vì hardware ngày càng mạnh hơn:
```
2024: cost=12 → ~300 hash/giây → an toàn
2029: GPU mạnh gấp 10x → ~3000 hash/giây → kém an toàn hơn
```

**Migrate dần khi user login — không cần bắt đổi password:**

```js
const valid = await bcrypt.compare(password, user.passwordHash);
if (!valid) return res.status(401)...

// Kiểm tra cost factor cũ
const currentCost = parseInt(user.passwordHash.split('$')[2]);

if (currentCost < 14) {
  const newHash = await bcrypt.hash(password, 14);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash }
  });
}
```

User login → tự động rehash với cost mới → hoàn toàn tự động, user không biết.

---

## PHẦN 2 — JWT

### Câu 10: JWT là gì, cấu trúc gồm mấy phần?

JWT (JSON Web Token) là chuỗi định danh người dùng gồm 3 phần ngăn cách bởi dấu `.`:

**Header:**
```json
{ "alg": "HS256", "typ": "JWT" }
```

**Payload:**
```json
{ "userId": 123, "username": "alice", "exp": 1735689600 }
```

**Signature:**
```
HMAC-SHA256(base64(header) + "." + base64(payload), JWT_SECRET)
```

**Quan trọng:** Payload chỉ được encode Base64, không phải mã hóa — ai cũng đọc được. Không bao giờ bỏ thông tin nhạy cảm (password, CCCD) vào payload.

---

### Câu 11: `JWT_SECRET` dùng để làm gì, nếu bị lộ thì sao?

JWT_SECRET dùng để **ký HMAC-SHA256** — kết hợp với nội dung token tạo ra chữ ký. Không có secret → không tạo được chữ ký hợp lệ → không giả mạo được.

**Nếu bị lộ:**
```
Hacker có JWT_SECRET
→ tự tạo token: { "userId": 1, "username": "admin" }
→ ký bằng JWT_SECRET → token hợp lệ
→ chiếm quyền admin mà không cần password
```

**Bảo vệ JWT_SECRET:**
- Lưu trong `.env`, không commit lên git
- Tạo đủ dài và ngẫu nhiên: `openssl rand -base64 64`
- Rotate khi nghi ngờ bị lộ

---

### Câu 12: JWT có thể bị giả mạo không?

**Không** — vì không có JWT_SECRET thì không tạo được signature hợp lệ.

Khi verify:
```
Server nhận token → tách header + payload + signature
→ tự tính lại HMAC(header + payload, JWT_SECRET)
→ so sánh với signature trong token
→ không khớp → từ chối
```

**Nếu hacker lấy được token hợp lệ:**
- Gọi API với quyền của user đó
- Đổi thông tin profile, xóa dữ liệu, gửi tin nhắn giả danh
- Dùng được đến khi token hết hạn 7 ngày

**Hệ thống chống bằng:**
- `expiresIn: '7d'` — token hết hạn sau 7 ngày
- Redis blocklist — user logout ngay khi phát hiện bị lộ token
- HTTPS — tránh bị bắt token trên đường truyền

---

## PHẦN 3 — LOGOUT + REDIS

### Câu 13: Tại sao logout cần Redis, xóa token ở client không đủ sao?

Xóa token ở client chỉ khiến **user không dùng được nữa**, nhưng token vẫn còn hiệu lực trên server.

```
User logout → xóa token khỏi browser
Hacker đã copy token trước đó → vẫn còn giữ
Hacker gửi request với token cũ → server verify → hợp lệ → cho qua
```

JWT là **stateless** — server không lưu danh sách token đang active, chỉ verify chữ ký.

**Redis blocklist giải quyết:**
```js
await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
```

Token bị vô hiệu hóa ngay trên server — dù hacker có token cũng không dùng được.

---

### Câu 14: Giải thích các tham số trong `redis.set()`

```js
await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
```

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| Key | `blocklist:${token}` | Tên key, prefix để phân biệt với key khác |
| Value | `'1'` | Chỉ cần đánh dấu tồn tại, value không quan trọng |
| Option | `'EX'` | Báo tham số tiếp theo là thời gian hết hạn (giây) |
| TTL | `exp - Math.floor(Date.now()/1000)` | Số giây token còn sống |

**Tại sao TTL phải khớp với thời gian hết hạn token:**
```
Token còn 6 ngày → lưu blocklist 6 ngày → Redis tự xóa
Nếu lưu mãi mãi → hàng triệu token cũ tích tụ → Redis hết bộ nhớ
```

**Tại sao cần `if (ttl > 0)`:**
```
Token hết hạn lúc 8:00, user logout lúc 8:05
ttl = -300 (âm)
redis.set với ttl âm → throw error → server crash
```

---

### Câu 15: Nếu Redis bị down thì sao?

**Logout thất bại:**
```js
await redis.set(...) // throw error → token không được block
```

**Middleware không check được blocklist:**
```js
await redis.get(...) // throw error → không biết token đã logout chưa
```

**Xử lý bằng try/catch:**
```js
if (ttl > 0) {
  try {
    await redis.set(`blocklist:${token}`, '1', 'EX', ttl);
  } catch (err) {
    console.error('Redis down:', err);
    // Vẫn trả logout thành công, chấp nhận rủi ro nhỏ
  }
}
```

Với app chat thông thường → **cho qua** khi Redis down là hợp lý, ưu tiên trải nghiệm hơn bảo mật tuyệt đối.

---

## PHẦN 4 — TỔNG QUAN

### Câu 16: Toàn bộ luồng đăng ký → đăng nhập → gọi API → logout

**Đăng ký:**
```
{ username, password } → validate → check username tồn tại
→ bcrypt.hash(password, 12) → lưu { username, passwordHash } vào DB
→ 201 "Đăng ký thành công"
```

**Đăng nhập:**
```
{ username, password } → validate → query DB
→ luôn chạy bcrypt.compare (chống timing attack)
→ if (!user || !valid) → 401 (gộp chung chống information disclosure)
→ jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' })
→ trả token về client
```

**Gọi API:**
```
Authorization: Bearer <token>
→ check Redis blocklist → có → 401
→ jwt.verify(token, JWT_SECRET) → sai/hết hạn → 401
→ gắn req.user → xử lý request bình thường
```

**Logout:**
```
Verify token → tính ttl = exp - Date.now()/1000
→ if (ttl > 0) → redis.set(blocklist:token, '1', EX, ttl)
→ "Logged out"
```

---

### Câu 17: Nếu hacker lấy được database thì sao?

**Không đăng nhập được** vì:
- DB chỉ lưu bcrypt hash, không có plaintext
- Bcrypt một chiều, không tính ngược được
- Brute force với cost=12 chỉ ~300 lần thử/giây → password 8 ký tự mất hàng trăm năm
- Mỗi user có salt riêng → không thể tấn công hàng loạt, phải brute force từng user một

---

### Tổng hợp bảo mật

| Tấn công | Được chống bởi |
|---|---|
| Lấy DB → crack password | bcrypt hash + salt riêng mỗi user |
| Đoán username tồn tại | DUMMY_HASH + timing đều ~300ms |
| Biết sai username hay password | Gộp chung `if (!user \|\| !valid)` |
| Brute force login | Rate limiting + bcrypt chậm |
| Giả mạo JWT token | JWT_SECRET + HMAC-SHA256 signature |
| Dùng token đã logout | Redis blocklist |
| Bắt token trên đường truyền | HTTPS |