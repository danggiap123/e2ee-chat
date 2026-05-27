// Dùng: node scripts/add-employee.js email@domain.com
// Chạy từ thư mục backend/

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const email = process.argv[2];

async function main() {
  if (!email) {
    console.error('Thiếu email. Cách dùng: node scripts/add-employee.js email@domain.com');
    process.exit(1);
  }

  await prisma.allowedEmail.create({
    data: { email },
  });

  console.log(`Đã thêm vào whitelist: ${email}`);
}

main()
  .catch((err) => {
    // P2002 = unique constraint violation — email đã có trong whitelist rồi
    if (err.code === 'P2002') {
      console.error(`Email đã tồn tại trong whitelist: ${email}`);
    } else {
      console.error('Lỗi:', err.message);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
