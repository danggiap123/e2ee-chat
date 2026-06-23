/**
 * Benchmark 1: HTTP REST — Login throughput
 *
 * Mục tiêu: đo xem server chịu được bao nhiêu req/s cho endpoint /auth/login
 * trước khi latency tăng hoặc error rate vượt 1%.
 *
 * Chạy: k6 run benchmark/01_http_login.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate  = new Rate('errors');
const loginTime  = new Trend('login_duration', true); // true = hiển thị milliseconds

// ─── Cấu hình phases ─────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 20  }, // ramp up: 0 → 20 VU trong 30s
    { duration: '60s', target: 20  }, // giữ 20 VU trong 60s (steady state)
    { duration: '30s', target: 50  }, // tăng lên 50 VU
    { duration: '60s', target: 50  }, // giữ 50 VU
    { duration: '30s', target: 100 }, // tăng lên 100 VU
    { duration: '60s', target: 100 }, // giữ 100 VU
    { duration: '30s', target: 0   }, // ramp down
  ],
  thresholds: {
    // Benchmark pass nếu:
    'http_req_duration': ['p(95)<500'], // 95% request < 500ms
    'errors':            ['rate<0.01'], // error rate < 1%
  },
};

// FIX: route /api qua nginx (port 3000 không publish ra host)
const BASE_URL = __ENV.BASE_URL || 'http://localhost/api';

// FIX: /auth/login nhận field `username`, KHÔNG phải `email`
const TEST_USER = {
  username: __ENV.TEST_USERNAME || 'admin',
  password: __ENV.TEST_PASSWORD || 'Admin@123456',
};

export default function () {
  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify(TEST_USER),
    { headers: { 'Content-Type': 'application/json' } }
  );

  loginTime.add(Date.now() - start);

  const ok = check(res, {
    'status 200':    (r) => r.status === 200,
    'has token':     (r) => r.json('token') !== undefined,
  });

  errorRate.add(!ok);

  // Nghỉ ngắn để mô phỏng thực tế hơn (không spam liên tục)
  sleep(0.1);
}
