/**
 * Benchmark 3: WebSocket — Số kết nối đồng thời + message throughput
 *
 * Mục tiêu chính của đồ án: đo xem server chịu được bao nhiêu
 * WebSocket connection đồng thời trước khi bắt đầu bị lỗi.
 *
 * Cách hoạt động:
 *   - Mỗi VU = 1 WebSocket connection (1 user online)
 *   - Mỗi VU gửi ping mỗi 5 giây, đo latency pong
 *   - Tăng dần VU từ 10 → 500 để tìm điểm giới hạn
 *
 * Yêu cầu: -e TOKEN=<jwt> (có thể dùng cùng token cho tất cả VU —
 *   chỉ để test infra, không test auth)
 *
 * Chạy: k6 run benchmark/03_ws_concurrent.js -e TOKEN=<jwt>
 */
import ws       from 'k6/ws';
import { check } from 'k6';
import { Rate, Trend, Gauge } from 'k6/metrics';
import encoding  from 'k6/encoding';

const connectErrors  = new Rate('ws_connect_errors');
const pongLatency    = new Trend('ws_pong_latency', true);
const activeConns    = new Gauge('ws_active_connections');

export const options = {
  stages: [
    { duration: '30s', target: 50  }, // 50 connections
    { duration: '30s', target: 100 }, // 100 connections
    { duration: '30s', target: 200 }, // 200 connections
    { duration: '30s', target: 300 }, // 300 connections
    { duration: '60s', target: 300 }, // giữ 300 (steady state để xem memory leak)
    { duration: '30s', target: 500 }, // cố 500 — xem server có chịu không
    { duration: '60s', target: 500 },
    { duration: '30s', target: 0   },
  ],
  thresholds: {
    'ws_connect_errors': ['rate<0.05'],    // cho phép 5% lỗi kết nối
    'ws_pong_latency':   ['p(95)<200'],    // pong < 200ms ở p95
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/ws';
const TOKEN  = __ENV.TOKEN  || '';

if (!TOKEN) throw new Error('Cần truyền -e TOKEN=<jwt>');

export default function () {
  const url = `${WS_URL}?token=${TOKEN}`;

  const res = ws.connect(url, {}, function (socket) {
    activeConns.add(1);

    socket.on('open', () => {
      // Gửi ping mỗi 5 giây, đo thời gian nhận pong
      let pingStart = 0;

      const pingInterval = setInterval(() => {
        pingStart = Date.now();
        socket.send(JSON.stringify({ type: 'ping' }));
      }, 5000);

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'pong' && pingStart > 0) {
            pongLatency.add(Date.now() - pingStart);
            pingStart = 0;
          }
        } catch (_) { /* ignore non-JSON */ }
      });

      // Giữ connection mở đúng bằng duration của stage hiện tại
      socket.setTimeout(() => {
        clearInterval(pingInterval);
        socket.close();
      }, 280000); // 280s — bằng tổng duration stages (trừ ramp down)
    });

    socket.on('close', () => {
      activeConns.add(-1);
    });

    socket.on('error', (e) => {
      connectErrors.add(1);
      activeConns.add(-1);
    });
  });

  check(res, { 'ws connected': (r) => r && r.status === 101 });
  if (!res || res.status !== 101) connectErrors.add(1);
}
