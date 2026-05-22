function lexCompare(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export async function generateFingerprint(IK_pub_A, IK_pub_B) {
  // Bước 1: sort để Alice và Bob ra cùng kết quả dù gọi theo thứ tự nào
  const [first, second] = lexCompare(IK_pub_A, IK_pub_B) <= 0
    ? [IK_pub_A, IK_pub_B]
    : [IK_pub_B, IK_pub_A];

  // Bước 2: ghép 2 key lại = 64 bytes
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);

  // Bước 3: hash SHA-512 lặp 5200 vòng — chống brute force giả mạo key
  let hash = await crypto.subtle.digest('SHA-512', combined);
  for (let i = 0; i < 5199; i++) {
    hash = await crypto.subtle.digest('SHA-512', hash);
  }

  // Bước 4: chuyển 64 bytes hash → số BigInt → lấy 60 chữ số cuối
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const digits = (BigInt('0x' + hex) % (10n ** 60n)).toString().padStart(60, '0');

  return digits;
}
