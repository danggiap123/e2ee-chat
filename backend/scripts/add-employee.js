// Dùng: node scripts/add-employee.js email1@domain.com email2@domain.com ...
// Chạy từ thư mục backend/

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const emails = process.argv.slice(2);

async function main() {
  if (emails.length === 0) {
    console.error('Thiếu email. Cách dùng: node scripts/add-employee.js email1@domain.com email2@domain.com');
    process.exit(1);
  }

  for (const email of emails) {
    try {
      await prisma.allowedEmail.create({ data: { email } });
      console.log(`✓ Đã thêm: ${email}`);
    } catch (err) {
      if (err.code === 'P2002') {
        console.warn(`⚠ Đã tồn tại: ${email}`);
      } else {
        console.error(`✗ Lỗi (${email}):`, err.message);
      }
    }
  }
}

main().finally(async () => { await prisma.$disconnect(); });
