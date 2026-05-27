-- CreateTable: AllowedEmail — whitelist email được phép đăng ký
CREATE TABLE "AllowedEmail" (
    "id"        TEXT         NOT NULL,
    "email"     TEXT         NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllowedEmail_email_key" ON "AllowedEmail"("email");

-- AddColumn: email vào User
-- Bước 1: thêm cột nullable trước (vì đang có row cũ không có email)
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- Bước 2: gán email placeholder cho các row cũ (dựa vào id để đảm bảo unique)
UPDATE "User" SET "email" = CONCAT('legacy_', "id", '@placeholder.local') WHERE "email" IS NULL;

-- Bước 3: đặt NOT NULL sau khi tất cả row đã có giá trị
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- Bước 4: tạo unique index
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
