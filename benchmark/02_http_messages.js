/**
 * Benchmark 2: HTTP REST — Gửi tin nhắn throughput
 *
 * Mục tiêu: đo RPS của POST /messages (endpoint nặng nhất:
 * verify JWT → query DB conversation → insert message → relay WS)
 *
 * Yêu cầu: chạy 00_setup.js trước để lấy token + conversationId
 * Chạy: k6 run benchmark/02_http_messages.js \
 *         -e TOKEN=<jwt> -e CONV_ID=<uuid>
 */
import http     from 'k6/http';
import encoding  from 'k6/encoding';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate   = new Rate('errors');
const msgDuration = new Trend('msg_send_duration', true);
const msgSent     = new Counter('messages_sent');

export const options = {
  stages: [
    { duration: '20s', target: 10  },
    { duration: '60s', target: 10  },
    { duration: '20s', target: 30  },
    { duration: '60s', target: 30  },
    { duration: '20s', target: 50  },
    { duration: '60s', target: 50  },
    { duration: '20s', target: 0   },
  ],
  thresholds: {
    'http_req_duration':  ['p(95)<800'],
    'errors':             ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL    || 'http://localhost:3000';
const TOKEN    = __ENV.TOKEN       || '';   // JWT của sender
const CONV_ID  = __ENV.CONV_ID     || '';   // conversationId đã tạo sẵn

if (!TOKEN || !CONV_ID) {
  throw new Error('Cần truyền -e TOKEN=<jwt> -e CONV_ID=<uuid>. Chạy 00_setup.js trước.');
}

const HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

// Payload tin nhắn giả (đã "mã hóa") — để đo thuần backend overhead
// Trong thực tế ciphertext sẽ dài hơn, ở đây dùng base64 giả 64 bytes
const FAKE_PAYLOAD = {
  conversationId: CONV_ID,
  ciphertext: encoding.b64encode('A'.repeat(64)),
  iv:         encoding.b64encode('B'.repeat(12)),
  aad:        encoding.b64encode(JSON.stringify({ convId: CONV_ID, ts: 0 })),
};

export default function () {
  // Mỗi VU dùng timestamp khác nhau để tránh unique constraint (iv phải unique per conv)
  const payload = { ...FAKE_PAYLOAD, iv: encoding.b64encode(`iv-${__VU}-${Date.now()}-${Math.random()}`) };

  const start = Date.now();
  const res   = http.post(
    `${BASE_URL}/messages`,
    JSON.stringify(payload),
    { headers: HEADERS }
  );
  msgDuration.add(Date.now() - start);

  const ok = check(res, {
    'status 201': (r) => r.status === 201,
  });

  errorRate.add(!ok);
  if (ok) msgSent.add(1);

  sleep(0.05);
}
