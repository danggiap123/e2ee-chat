# Tổng hợp câu hỏi & trả lời — Routes, Schema, JavaScript cơ bản

---

## PHẦN 1 — JAVASCRIPT CƠ BẢN

### Câu 1: async/await là gì, tại sao cần?

Node.js chỉ có 1 luồng chính. Khi gọi `prisma.user.findUnique()`, DB cần thời gian tìm kiếm (~5-50ms). Nếu không có async/await, Node.js đứng im chờ → không xử lý được request khác.

```js
// Không có await → nhận về Promise, không phải data thật
const user = prisma.user.findUnique(...);
console.log(user); // Promise { <pending> }

// Có await → nhận data thật, Node.js vẫn xử lý request khác trong lúc chờ
const user = await prisma.user.findUnique(...);
console.log(user); // { id: "abc", username: "alice" }
```

**Quy tắc:** Hàm có `await` bên trong PHẢI có `async` ở đầu, nếu không → SyntaxError.

**`async` làm 2 việc:**
1. Báo JavaScript hàm này có bất đồng bộ bên trong
2. Tự động bọc kết quả trả về thành Promise

---

### Câu 2: Arrow function là gì, khác hàm thường chỗ nào?

```js
// Hàm thường
async function handler(req, res) { ... }

// Arrow function — cùng chức năng, viết ngắn hơn
async (req, res) => { ... }
```

Trong Express, arrow function thường được truyền thẳng vào route:
```js
router.post('/register', registerLimiter, async (req, res) => {
  // handler viết thẳng ở đây
});
```

---

### Câu 3: Callback là gì?

Truyền hàm làm tham số vào hàm khác — hàm đó sẽ được gọi sau khi có sự kiện xảy ra.

```js
router.post('/register', registerLimiter, handler);
//                                         ↑ callback — Express tự gọi khi có request

handler        // truyền hàm vào — ĐÚNG
handler()      // gọi hàm ngay — SAI, không dùng thế này trong route
```

---

### Câu 4: Toán tử `??` khác `||` chỗ nào?

```js
// || — falsy check (null, undefined, "", 0, false đều bị thay)
"" || null   // → null   (string rỗng bị mất)
0  || null   // → null   (số 0 bị mất)

// ?? — nullish check (chỉ null và undefined mới bị thay)
"" ?? null   // → ""    (string rỗng giữ nguyên)
0  ?? null   // → 0     (số 0 giữ nguyên)
```

Trong project dùng `ekPub ?? null` vì ekPub có thể là string hợp lệ bất kỳ — không muốn bị mất.

---

### Câu 5: Spread operator `...` trong object là gì?

```js
// Thay vì viết:
prisma.message.findMany({
  where: ...,
  cursor: { id: cursor },
  skip: 1,
})

// Dùng spread để thêm điều kiện nếu có cursor:
prisma.message.findMany({
  where: ...,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
})
// Có cursor → trải { cursor, skip } vào object
// Không có cursor → trải {} → không thêm gì
```

---

### Câu 6: Destructuring + Rest operator là gì?

```js
const [opkPub, ...remainingOpks] = ["a", "b", "c"];
// opkPub        = "a"         ← phần tử đầu tiên
// remainingOpks = ["b", "c"]  ← mảng còn lại (rest)
```

---

## PHẦN 2 — RATE LIMITING

### Câu 7: Rate limiting hoạt động theo cơ chế nào?

Fixed Window — cửa sổ thời gian bắt đầu từ request ĐẦU TIÊN của IP đó:

```
IP gửi lần đầu → window bắt đầu đếm
Đủ limit       → chặn 429 cho đến khi window reset
Window hết     → đếm lại từ 0
```

**Điểm yếu Fixed Window:** 10 request cuối window + 10 request đầu window tiếp theo = 20 request trong 2 giây.

**Tại sao register=10, login=20?**
- Register: hiếm khi cần đăng ký nhiều lần → giới hạn chặt
- Login: có thể gõ sai vài lần → cho phép thoải mái hơn

---

### Câu 8: Rate limiter đếm request thất bại (400, 409) không?

**Có** — rate limiter là middleware chạy TRƯỚC handler. Dù handler trả 400 hay 409, rate limiter đã đếm rồi. Đây là hành vi đúng — tránh attacker dùng request lỗi để dò thông tin mà không bị đếm.

---

## PHẦN 3 — CHỐNG REPLAY ATTACK

### Câu 9: Replay attack là gì, xảy ra ở đâu?

Attacker chặn gói tin HTTP hợp lệ, gửi lại y hệt lên server. Server không phân biệt được với request thật.

**Trong hệ thống này:** Attacker chặn `POST /messages` → gửi lại → server lưu tin nhắn trùng vào DB → Bob nhận tin lặp.

---

### Câu 10: Cách chống replay attack bằng IV unique constraint

IV được sinh ngẫu nhiên 12 bytes mỗi tin → replay attack gửi lại đúng gói tin cũ → IV trùng 100%.

```prisma
@@unique([conversationId, iv])  // PostgreSQL từ chối nếu IV trùng trong cùng conversation
```

```js
// Trong catch của POST /messages:
if (err.code === 'P2002') {  // P2002 = Prisma unique constraint violation
  return res.status(409).json({ error: 'Phát hiện tấn công phát lại' });
}
```

**Tại sao unique theo (conversationId, iv) chứ không chỉ iv?**
IV chỉ cần duy nhất trong 1 conversation — 2 conversation khác nhau có thể trùng IV mà không phải replay attack.

---

### Câu 11: IV dùng để làm gì, khác gì nonce trong replay attack?

**IV (Initialization Vector):** Đảm bảo cùng plaintext + cùng key → ciphertext khác nhau mỗi lần. Không phải để chống replay attack.

```
encrypt("Xin chào", SK, IV=aaa) → ciphertext_1
encrypt("Xin chào", SK, IV=bbb) → ciphertext_2  ← hoàn toàn khác
```

**Dùng IV để chống replay** là tác dụng phụ — cần thêm bước server check IV đã dùng chưa.

---

## PHẦN 4 — PRISMA SCHEMA

### Câu 12: Các tham số trong schema.prisma

| Tham số | Phạm vi | Tác dụng |
|---|---|---|
| `@id` | 1 cột | Primary key — định danh duy nhất mỗi hàng |
| `@default(uuid())` | 1 cột | PostgreSQL tự sinh UUID khi insert |
| `@default(now())` | 1 cột | PostgreSQL tự lấy thời gian hiện tại |
| `@unique` | 1 cột | Giá trị không được trùng |
| `@@unique([a,b])` | Nhiều cột | Tổ hợp không được trùng |
| `@@index([a,b])` | Nhiều cột | Tăng tốc query tìm kiếm |
| `@relation` | 1 cột | Foreign key liên kết 2 bảng |
| `String?` | 1 cột | Nullable — cho phép NULL |

---

### Câu 13: @@unique vs @unique khác nhau chỗ nào?

```prisma
username String @unique          // 1 cột — username không được trùng với bất kỳ hàng nào khác

@@unique([participantA, participantB])  // tổ hợp — từng cột riêng CÓ THỂ trùng
                                        // nhưng cặp (A, B) không được trùng
```

```
participantA=alice, participantB=bob   → ✅
participantA=alice, participantB=charlie → ✅ (alice trùng nhưng charlie khác)
participantA=alice, participantB=bob   → ❌ (cả 2 trùng)
```

---

### Câu 14: Migration là gì, tại sao cần?

Migration là lịch sử thay đổi cấu trúc DB theo thứ tự thời gian. Mỗi lần sửa schema → tạo 1 file SQL ghi lại thay đổi.

**Tại sao cần:**
- Dựng lại DB từ đầu trên máy mới → chạy lần lượt các migration → DB y hệt
- Team nhiều người → ai cũng biết DB đang ở trạng thái nào
- Rollback được nếu migration gây lỗi

---

## PHẦN 5 — THIẾT KẾ API

### Câu 15: Tại sao senderId lấy từ req.user.userId thay vì req.body?

Nếu client tự gửi `senderId` lên body → attacker đăng nhập bằng tài khoản mình nhưng điền `senderId` của người khác → mạo danh người khác gửi tin.

`req.user.userId` được lấy từ JWT đã verify → server đảm bảo đây là đúng người đang đăng nhập → không thể giả mạo.

---

### Câu 16: select trong Prisma dùng để làm gì?

```js
select: {
  id: true, senderId: true, ciphertext: true, ...
}
```

Chỉ lấy đúng cột cần thiết — không lấy thừa. Nếu không có `select`, Prisma lấy tất cả cột → tốn băng thông, tốn RAM, chậm hơn.

---

### Câu 17: Cursor pagination — client lưu cursor ở đâu?

Server KHÔNG lưu cursor — chỉ tính `nextCursor` rồi trả về cho client. Client tự lưu vào biến JavaScript, đính vào URL khi muốn load thêm:

```
GET /messages/conv-001?cursor=id-của-T8&limit=20
                        ↑ client tự gửi lên qua query string
```

Server đọc cursor qua `req.query.cursor`. Mỗi request độc lập hoàn toàn — server không giữ trạng thái.

---

### Câu 18: Cursor pagination vs OFFSET — tại sao cursor tốt hơn?

**OFFSET truyền thống** (`LIMIT 20 OFFSET 40`):
- DB phải đọc và bỏ qua 40 dòng đầu rồi mới lấy 20 dòng tiếp → càng vào sâu càng chậm
- Nếu có tin mới thêm vào trong lúc phân trang → dữ liệu bị lệch (tin bị bỏ sót hoặc hiện 2 lần)

**Cursor pagination** (`WHERE id < cursor LIMIT 20`):
- DB dùng index trên `id` → nhảy thẳng đến vị trí cần → O(log n) thay vì O(n)
- Cursor "ghim" vị trí theo id cụ thể → tin mới thêm vào không làm dịch chuyển cursor

```
Trang 1: lấy 5 tin mới nhất → trả về tin 10,9,8,7,6 → nextCursor = id tin 6
→ Bob gửi tin 11 (tin mới)
Trang 2: "lấy 5 tin trước cursor (tin 6)" → trả về tin 5,4,3,2,1
→ Tin 11 KHÔNG ảnh hưởng gì
```

`skip: 1` trong code để bỏ qua chính tin có id = cursor (đã load ở trang trước), tránh trùng.

---

### Câu 19: Nếu đang phân trang mà có tin mới, WebSocket xử lý thế nào?

Pagination và WebSocket là **2 cơ chế độc lập, chạy song song**:

| Cơ chế | Vai trò |
|---|---|
| Pagination (cursor) | Tải lịch sử cũ khi scroll lên |
| WebSocket | Nhận tin mới real-time |

Khi Alice scroll lên xem tin cũ → WebSocket vẫn chạy nền, lắng nghe tin mới. Bob gửi tin → WebSocket đẩy xuống → frontend append vào cuối danh sách. ID của mỗi tin là UUID cố định, không bao giờ thay đổi.

---

### Câu 20: IDOR là gì? Lỗ hổng trong DELETE /messages

**IDOR — Insecure Direct Object Reference** (OWASP Top 10):
- Client truyền thẳng `id` của object vào URL
- Server chỉ check đăng nhập, không check **quyền** trên object đó

```js
// Nếu không có dòng này:
if (message.senderId !== req.user.userId) { ... }

// Bob biết id tin nhắn của Alice → gửi DELETE /messages/abc-123
// Server thấy Bob đã đăng nhập → xóa luôn tin của Alice!
```

**Fix:** so sánh `message.senderId` với `req.user.userId` (lấy từ JWT, không thể giả mạo).

> **Nguyên tắc:** Đăng nhập ≠ có quyền. Phải check cả 2.

---

## PHẦN 6 — REDIS & SERVER

### Câu 21: Tại sao redis.js export một Singleton thay vì để mỗi file tự `new Redis()`?

```js
// redis.js — tạo 1 lần duy nhất
const redis = new Redis(process.env.REDIS_URL);
module.exports = redis;

// auth.js, keys.js, messages.js — đều require cùng 1 object
const redis = require('../redis');
```

Mỗi `new Redis()` = mở 1 TCP connection đến Redis server. Nếu 5 file tự tạo → 5 connection thường trực, tốn RAM và file descriptor không cần thiết.

Node.js **cache kết quả của `require()`** — lần đầu chạy `redis.js` thì tạo object, các lần `require` sau trả về object đã cache → tất cả dùng chung **1 TCP connection**.

> **Pattern này gọi là Singleton** — resource tốn kém (DB connection, Redis connection) nên tạo 1 lần, dùng nhiều nơi.

---

### Câu 22: Nếu bỏ `redis.on('error', ...)` thì điều gì xảy ra?

Redis client kế thừa từ **EventEmitter** của Node.js. Quy tắc của Node.js: nếu event `'error'` được emit mà **không có handler** → Node.js throw UnhandledError → **crash toàn bộ process ngay lập tức**.

```js
redis.on('error', (err) => console.error('Redis error:', err));
// Lỗi được bắt và log → ioredis tự động reconnect
// Server vẫn sống, chỉ các request cần Redis bị lỗi tạm thời
```

---

### Câu 23: Tại sao `dotenv.config()` phải ở dòng đầu tiên của server.js?

```js
require('dotenv').config();             // dòng 1 — load .env vào process.env
const redis = require('./redis');       // dòng 2 — redis.js chạy ngay lập tức
                                        //           → new Redis(process.env.REDIS_URL)
```

`require('./redis')` **chạy ngay** khi Node.js đọc đến dòng đó. Nếu `dotenv.config()` đặt sau → `process.env.REDIS_URL = undefined` tại thời điểm kết nối Redis → thất bại.

> **Quy tắc:** `dotenv.config()` phải là dòng đầu tiên của entry point, trước mọi `require` khác.

---

### Câu 24: `express.json()` làm gì? Nếu bỏ thì `req.body` là gì?

HTTP request gửi lên là **raw bytes** (luồng chưa đọc). Express không tự parse body.

`express.json()` làm 3 bước:
1. Đọc hết stream (gom bytes lại)
2. Decode thành string UTF-8
3. `JSON.parse(string)` → JavaScript object → gán vào `req.body`

Nếu bỏ middleware này → `req.body = undefined` → mọi destructuring `const { username } = req.body` đều ra `undefined` → validation thất bại.

---

### Câu 25: URL đầy đủ được ghép như thế nào từ prefix và router?

```js
// server.js
app.use('/auth', authRoutes);      // prefix /auth

// auth.js
router.post('/register', ...);     // route /register
```

Express ghép: `/auth` + `/register` = **`POST /auth/register`**

Lý do tách prefix + Router: `server.js` chỉ là nơi **mount** route, không chứa logic. Mỗi file route lo đúng 1 domain → dễ maintain, dễ đọc.

---

## PHẦN 7 — CONVERSATIONS

### Câu 26: Tại sao tìm cả 2 chiều A↔B khi check conversation tồn tại?

```js
OR: [
  { participantA: Alice, participantB: Bob },   // Alice tạo trước
  { participantA: Bob,   participantB: Alice },  // Bob tạo trước
]
```

Nếu chỉ tìm 1 chiều: Alice tạo conversation (A=Alice, B=Bob) → Bob sau đó cũng tạo (A=Bob, B=Alice) → không tìm thấy → tạo thêm 1 conversation thứ 2 → lịch sử chat bị tách đôi, 2 người nhắn ở 2 nơi khác nhau.

> **Nguyên tắc:** quan hệ 2 người là không có thứ tự (A↔B = B↔A), nhưng DB lưu có thứ tự → phải tìm cả 2 chiều.

---

### Câu 27: Tại sao phải xóa Message trước khi xóa Conversation?

**Foreign Key Constraint** — `Message.conversationId` trỏ vào `Conversation.id`.

Nếu xóa Conversation trước: PostgreSQL kiểm tra còn Message nào có `conversationId` đó không → có → vi phạm ràng buộc → throw lỗi, rollback, không xóa được gì.

```js
// Thứ tự đúng — xóa con trước, xóa cha sau:
await prisma.message.deleteMany({ where: { conversationId: convId } }); // xóa con
await prisma.conversation.delete({ where: { id: convId } });            // xóa cha
```

Foreign Key tồn tại để bảo vệ tính toàn vẹn dữ liệu — không cho phép "tin nhắn mồ côi" (Message không thuộc Conversation nào).

---

## PHẦN 8 — THIẾT KẾ HỆ THỐNG & UX

### Câu 28: `search.trim()` là gì, tại sao cần 2 bước validate?

`trim()` là method của string — xóa khoảng trắng ở đầu và cuối:
```js
"  alice  ".trim() → "alice"
"   ".trim()       → ""
```

2 bước validate trong `GET /users`:
```js
if (!search || search.trim() === '') { ... }  // bắt undefined + toàn khoảng trắng
if (search.trim().length < 2) { ... }         // bắt quá ngắn (1 ký tự trả về quá nhiều kết quả)
```
Nếu chỉ check `!search` thì `?search=   ` (toàn space) sẽ lọt qua vì string không rỗng là truthy.

---

### Câu 29: `contains` vs `startsWith` trong Prisma search

```js
username: { contains: "bob", mode: 'insensitive' }
// SQL: WHERE username ILIKE '%bob%'
// "bob" khớp: "bob01", "mybob", "abobcd"

username: { startsWith: "bob", mode: 'insensitive' }
// SQL: WHERE username ILIKE 'bob%'
// "bob" khớp: "bob01" — KHÔNG khớp "mybob"
```

Dự án dùng `contains` để tìm linh hoạt hơn. `startsWith` phù hợp hơn về UX (người dùng gõ từ đầu tên) nhưng `contains` bắt được cả trường hợp tên ở giữa.

---

### Câu 30: Tại sao `GET /conversations` phải lấy cả `userA` và `userB`?

Khi query danh sách conversation của Alice, Alice có thể đóng vai A trong conv này nhưng vai B trong conv khác:
```
Conv 1: Alice tạo trước → participantA=Alice, participantB=Bob
Conv 2: Charlie tạo → participantA=Charlie, participantB=Alice
```
Nếu chỉ lấy `userA` → Conv 2 thiếu thông tin Charlie. Phải lấy cả 2 rồi tìm "người kia":
```js
const isA  = conv.userA.id === req.user.userId;
const peer = isA ? conv.userB : conv.userA;
```

---

### Câu 31: `conv.messages[0]?.createdAt ?? conv.createdAt` — cú pháp này là gì?

**Optional chaining `?.`**: nếu `messages[0]` không tồn tại (conv chưa có tin) → không crash, trả `undefined` thay vì throw error.

**Nullish coalescing `??`**: nếu kết quả là `undefined` → dùng `conv.createdAt` (ngày tạo conversation) làm fallback.

Kết hợp: "lấy timestamp tin cuối nếu có, nếu không thì lấy ngày tạo conversation".

---

### Câu 32: Tại sao `PATCH /fingerprint` không cho phép unverify (set lại false)?

Fingerprint verify là hành động "tôi đã xác nhận danh tính người kia qua kênh ngoài (điện thoại/gặp mặt)". Một khi đã xác nhận thì không có lý do thu hồi.

Nếu cho unverify → attacker chiếm tài khoản có thể reset `fingerprintVerified = false` → chặn 2 người không chat được với nhau (DoS attack nội bộ).

---

### Câu 33: Fingerprint verify 1 phía hay 2 phía? Hạn chế là gì?

**Hiện tại — 1 boolean chung cho cả conversation:**
- Chỉ cần 1 người bấm "Xác nhận" → cả 2 đều được mở khóa
- B chưa tự tay xác nhận nhưng vẫn thấy "Đã xác nhận"

**Signal thực tế — 2 flag độc lập:**
```
fingerprintVerifiedA: Boolean  // Alice tự xác nhận
fingerprintVerifiedB: Boolean  // Bob tự xác nhận
// Chat khi cả 2 đều true
```

Thiết kế hiện tại là đơn giản hóa có chủ ý — ghi vào phần hạn chế của báo cáo.

**Verify offline:** Fingerprint verify là hành động ngoài băng tần — Alice gọi điện cho Bob, đọc 60 số, Bob không cần online trong app. Khi Bob vào app sau thì thấy đã verified.

---

### Câu 34: Redis-first hay DB-first khi gửi tin nhắn? Tại sao?

**Dự án chọn Redis-first** (publish trước, lưu DB sau):
```
1. Server nhận tin → publish Redis → Bob nhận ngay (<1ms)
2. Server lưu PostgreSQL → không block delivery
```

**Lý do:** Redis in-memory (<1ms) vs PostgreSQL disk I/O (~5ms). Với Redis-first, người dùng không cảm nhận được độ trễ.

**Rủi ro chấp nhận được:** Nếu server crash giữa bước 1 và 2 → Bob nhận tin nhưng lịch sử mất. Giảm thiểu bằng Redis AOF. Xác suất cực thấp ở quy mô 200 user.

> Discord, Slack dùng kiến trúc tương tự ở quy mô lớn.

---

### Câu 35: Online status — tại sao không vi phạm Blind Server model?

Online status = server biết ai đang có WebSocket connection active. Server đã biết điều này từ tầng network — không phải thông tin mới.

Không liên quan đến nội dung tin nhắn (ciphertext) → không vi phạm Blind Server model. Đây là **metadata** giống như timestamp — server vốn đã biết.

Implement: khi user connect WS → lưu `userId` vào Redis SET `online_users`. Khi disconnect → xóa. Broadcast status change đến những người có conversation chung.
