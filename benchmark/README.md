# Benchmark — E2EE Chat

## Cài đặt k6

```powershell
winget install k6
# hoặc: choco install k6
# hoặc tải binary: https://github.com/grafana/k6/releases
```

## Thứ tự chạy

### Bước 0: Khởi động server
```powershell
docker-compose up -d
```

### Bước 1: Lấy token + conversationId
```powershell
k6 run --vus 1 --iterations 1 benchmark/00_setup.js `
  -e ALICE_EMAIL=alice@company.com -e ALICE_PASS=Alice@123456 `
  -e BOB_EMAIL=bob@company.com     -e BOB_PASS=Bob@123456
```
Copy kết quả `ALICE_TOKEN`, `BOB_TOKEN`, `CONV_ID` ra.

---

### Benchmark 1: Login throughput
```powershell
k6 run benchmark/01_http_login.js `
  -e TEST_EMAIL=alice@company.com -e TEST_PASSWORD=Alice@123456
```

### Benchmark 2: Message send throughput
```powershell
k6 run benchmark/02_http_messages.js `
  -e TOKEN=<ALICE_TOKEN> -e CONV_ID=<CONV_ID>
```

### Benchmark 3: WebSocket — số connections đồng thời
```powershell
k6 run benchmark/03_ws_concurrent.js -e TOKEN=<ALICE_TOKEN>
```

### Benchmark 4: WebSocket — message relay throughput
```powershell
k6 run benchmark/04_ws_throughput.js `
  -e ALICE_TOKEN=<ALICE_TOKEN> -e BOB_TOKEN=<BOB_TOKEN> -e CONV_ID=<CONV_ID>
```

---

## Các chỉ số quan trọng cần chú ý

| Chỉ số | Ý nghĩa | Ngưỡng tốt |
|--------|---------|------------|
| `http_req_duration p(95)` | 95% request xong trong bao lâu | < 500ms |
| `http_reqs` | Tổng request/giây (RPS) | càng cao càng tốt |
| `ws_active_connections` | Số WS connection đang mở | — |
| `ws_pong_latency p(95)` | Độ trễ relay ping-pong | < 200ms |
| `ws_e2e_latency p(95)` | End-to-end latency qua relay | < 100ms |
| `errors` | Tỉ lệ lỗi | < 1% |

## Lưu ý

- Benchmark 3 (`03_ws_concurrent.js`) cần `ws.on('ping')` handler ở backend.
  Nếu backend chưa có, thay `type: 'ping'` bằng bất kỳ message nào server hiểu.
- Chạy benchmark khi server đã warm up (đã có ít nhất 1 request trước).
- Kết quả phụ thuộc vào hardware: ghi rõ CPU/RAM khi báo cáo.
