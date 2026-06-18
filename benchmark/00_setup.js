/**
 * Setup: Lấy token + conversationId để dùng cho các benchmark khác
 *
 * Chạy 1 lần: k6 run --vus 1 --iterations 1 benchmark/00_setup.js
 * Output sẽ in TOKEN và CONV_ID ra console.
 *
 * Yêu cầu: đã có 2 user (alice + bob) trong DB.
 * Nếu chưa có: đăng ký qua giao diện web hoặc POST /auth/register.
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Đổi thành email/password của 2 user thực trong DB
const ALICE = { email: __ENV.ALICE_EMAIL || 'alice@company.com', password: __ENV.ALICE_PASS || 'Alice@123456' };
const BOB   = { email: __ENV.BOB_EMAIL   || 'bob@company.com',   password: __ENV.BOB_PASS   || 'Bob@123456'   };

export default function () {
  const headers = { 'Content-Type': 'application/json' };

  // Login Alice
  const aliceRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify(ALICE), { headers });
  check(aliceRes, { 'alice login ok': (r) => r.status === 200 });
  const aliceToken  = aliceRes.json('token');
  const aliceUserId = aliceRes.json('userId');

  // Login Bob
  const bobRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify(BOB), { headers });
  check(bobRes, { 'bob login ok': (r) => r.status === 200 });
  const bobToken  = bobRes.json('token');
  const bobUserId = bobRes.json('userId');

  // Tạo conversation Alice → Bob (idempotent: nếu đã có sẽ trả về existing)
  const convRes = http.post(
    `${BASE_URL}/conversations`,
    JSON.stringify({ recipientId: bobUserId }),
    { headers: { ...headers, Authorization: `Bearer ${aliceToken}` } }
  );
  check(convRes, { 'conv created': (r) => r.status === 200 || r.status === 201 });
  const convId = convRes.json('id');

  console.log('\n========== COPY CÁC GIÁ TRỊ SAU ĐỂ CHẠY BENCHMARK ==========');
  console.log(`ALICE_TOKEN=${aliceToken}`);
  console.log(`BOB_TOKEN=${bobToken}`);
  console.log(`CONV_ID=${convId}`);
  console.log('==============================================================\n');
  console.log('Ví dụ chạy benchmark 2:');
  console.log(`k6 run benchmark/02_http_messages.js -e TOKEN=${aliceToken} -e CONV_ID=${convId}`);
  console.log('\nVí dụ chạy benchmark 3 (WS concurrent):');
  console.log(`k6 run benchmark/03_ws_concurrent.js -e TOKEN=${aliceToken}`);
  console.log('\nVí dụ chạy benchmark 4 (WS throughput):');
  console.log(`k6 run benchmark/04_ws_throughput.js -e ALICE_TOKEN=${aliceToken} -e BOB_TOKEN=${bobToken} -e CONV_ID=${convId}`);
}
