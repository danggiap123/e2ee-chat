/**
 * Benchmark 4: WebSocket — Message relay throughput (ACK latency)
 *
 * Mục tiêu: đo server xử lý được bao nhiêu tin nhắn/giây qua WebSocket,
 * và độ trễ từ lúc gửi đến lúc nhận ACK (save DB + relay xong).
 *
 * Cách đo: Alice gửi tin nhắn liên tục qua WS, đo thời gian nhận ACK.
 * ACK = server đã lưu DB + relay cho Bob (nếu Bob online) xong.
 *
 * Chạy: k6 run benchmark/04_ws_throughput.js \
 *         -e ALICE_TOKEN=<jwt> -e CONV_ID=<uuid>
 *         -e WS_URL=ws://localhost/ws  (nếu dùng nginx)
 */
import ws        from 'k6/ws';
import encoding  from 'k6/encoding';
import { check } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

const ackLatency    = new Trend('ws_ack_latency_ms', true);
const msgSent       = new Counter('ws_messages_sent');
const ackOk         = new Counter('ws_ack_ok');
const ackFail       = new Rate('ws_ack_fail');
const activeConns   = new Gauge('ws_senders');

export const options = {
  stages: [
    { duration: '10s', target: 1  },
    { duration: '60s', target: 1  },  // 1 sender: baseline
    { duration: '10s', target: 5  },
    { duration: '60s', target: 5  },  // 5 senders: light load
    { duration: '10s', target: 10 },
    { duration: '60s', target: 10 },  // 10 senders: medium load
    { duration: '10s', target: 0  },
  ],
  thresholds: {
    'ws_ack_latency_ms': ['p(95)<500'],  // ACK < 500ms (bao gồm DB write)
    'ws_ack_fail':       ['rate<0.01'],
  },
};

const WS_URL    = __ENV.WS_URL      || 'ws://localhost/ws';
const ALICE_TOK = __ENV.ALICE_TOKEN || '';
const CONV_ID   = __ENV.CONV_ID     || '';

if (!ALICE_TOK || !CONV_ID) {
  throw new Error('Cần: -e ALICE_TOKEN=<jwt> -e CONV_ID=<uuid>');
}

const FAKE_AAD = encoding.b64encode(JSON.stringify({ convId: CONV_ID, ts: 0 }));

export default function () {
  activeConns.add(1);

  ws.connect(`${WS_URL}?token=${ALICE_TOK}`, {}, function (socket) {
    // pending: Map iv → { sentAt }  — theo dõi ACK của từng message
    const pending = new Map();

    socket.on('open', () => {
      // Gửi 1 message mỗi 200ms (5 msg/s per VU)
      const interval = setInterval(() => {
        const iv = encoding.b64encode(`iv${Date.now()}${Math.random().toString(36).slice(2)}`);
        pending.set(iv, Date.now());

        socket.send(JSON.stringify({
          type:           'message',
          conversationId: CONV_ID,
          ciphertext:     encoding.b64encode('X'.repeat(48)),
          iv,
          aad: FAKE_AAD,
        }));
        msgSent.add(1);
      }, 200);

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data);

          if (msg.type === 'ack') {
            // Server trả ACK kèm msgId; chúng ta khớp qua pending map bằng thứ tự
            // (vì WS stream ordered, lấy entry đầu tiên trong pending)
            const firstKey = pending.keys().next().value;
            if (firstKey !== undefined) {
              const sentAt = pending.get(firstKey);
              ackLatency.add(Date.now() - sentAt);
              pending.delete(firstKey);

              if (msg.success) {
                ackOk.add(1);
              } else {
                ackFail.add(1);
                console.error(`ACK fail: ${msg.error}`);
              }
            }
          }
        } catch (_) {}
      });

      // Đóng sau khi chạy hết stages
      socket.setTimeout(() => {
        clearInterval(interval);
        socket.close();
      }, 225000);
    });

    socket.on('error', (e) => {
      ackFail.add(1);
    });
  });

  activeConns.add(-1);
}
