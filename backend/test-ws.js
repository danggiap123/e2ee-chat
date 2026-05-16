'use strict';

const WebSocket = require('ws');

// ── Dữ liệu test (lấy từ login + tạo conversation) ──────────────────────────
const ALICE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzMzdmYTU2Mi03MTY3LTQ0OTUtOWI1Zi1jNDhkZmUxMGE4MWMiLCJ1c2VybmFtZSI6ImFsaWNlIiwiaWF0IjoxNzc4NDQ3MjQ5LCJleHAiOjE3NzkwNTIwNDl9.tPU6pRPhp7hggpgvzyEaeELuzW0oJzQiJveSJjwPXgs';
const BOB_TOKEN   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxNTYwMmZjZS00OGQxLTQxM2ItYmFmZS04ODJhYWU3ZTlkZjgiLCJ1c2VybmFtZSI6ImJvYiIsImlhdCI6MTc3ODQ0NzI0OSwiZXhwIjoxNzc5MDUyMDQ5fQ.HzkAQmNCzMdN_aXJiFSXEWiCYPiH_XHTJi8I2Coe4Do';
const CONV_ID     = 'e0fbd9e2-2365-4dec-aa3c-5506db04d472';
const WS_URL      = 'ws://localhost:3000/ws';

// ── Helper: tạo WebSocket và log mọi event ───────────────────────────────────
function connect(name, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.on('open', () => {
      console.log(`[${name}] Kết nối thành công`);
      resolve(ws);
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log(`[${name}] Nhận:`, JSON.stringify(msg, null, 2));
    });

    ws.on('close', (code, reason) => {
      console.log(`[${name}] Đóng kết nối — code=${code} reason=${reason.toString()}`);
    });

    ws.on('error', (err) => {
      console.log(`[${name}] Lỗi:`, err.message);
    });
  });
}

// ── Helper: gửi message và log ───────────────────────────────────────────────
function send(name, ws, payload) {
  console.log(`[${name}] Gửi:`, JSON.stringify(payload));
  ws.send(JSON.stringify(payload));
}

// ── Helper: chờ ms millisecond ───────────────────────────────────────────────
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Chạy toàn bộ test ────────────────────────────────────────────────────────
async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 1: Kết nối WebSocket');
  console.log('═══════════════════════════════════════');
  const wsAlice = await connect('Alice', ALICE_TOKEN);
  await wait(300);

  const wsBob = await connect('Bob', BOB_TOKEN);
  await wait(300);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 2: Ping / Pong');
  console.log('═══════════════════════════════════════');
  send('Alice', wsAlice, { type: 'ping' });
  await wait(300);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 3: Alice gửi tin nhắn cho Bob');
  console.log('═══════════════════════════════════════');
  send('Alice', wsAlice, {
    type:           'message',
    conversationId: CONV_ID,
    ciphertext:     'bGFoZWxhbGFoZQ==',  // base64 giả lập ciphertext
    iv:             'aXZpdml2aXZpdg==',   // base64 giả lập IV (12 bytes)
    aad:            `${CONV_ID}:337fa562-7167-4495-9b5f-c48dfe10a81c`,
  });
  await wait(500);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 4: Gửi type không hợp lệ');
  console.log('═══════════════════════════════════════');
  send('Alice', wsAlice, { type: 'unknown_type' });
  await wait(300);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 5: Gửi JSON không hợp lệ');
  console.log('═══════════════════════════════════════');
  console.log('[Alice] Gửi: not-valid-json');
  wsAlice.send('not-valid-json');
  await wait(300);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 6: Bob ngắt kết nối → Alice nhận offline');
  console.log('═══════════════════════════════════════');
  wsBob.close();
  await wait(300);

  // ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 7: Alice gửi tin khi Bob offline');
  console.log('  → Tin lưu DB, không relay (không crash)');
  console.log('═══════════════════════════════════════');
  send('Alice', wsAlice, {
    type:           'message',
    conversationId: CONV_ID,
    ciphertext:     'b2ZmbGluZW1zZw==',
    iv:             'aXZvZmZsaW5lMTI=',
    aad:            `${CONV_ID}:337fa562-7167-4495-9b5f-c48dfe10a81c`,
  });
  await wait(500);

  // ─────────────────────────────────────────
  wsAlice.close();
  await wait(200);
  console.log('\n✅ Tất cả test hoàn thành');
}

run().catch(console.error);
