-- AlterTable Group: thêm cột adminId (admin hiện tại, có thể thay đổi)
-- Bước 1: thêm cột nullable trước
ALTER TABLE "Group" ADD COLUMN "adminId" TEXT;

-- Bước 2: fill adminId = createdBy cho tất cả nhóm hiện có
UPDATE "Group" SET "adminId" = "createdBy";

-- Bước 3: đặt NOT NULL sau khi đã fill xong
ALTER TABLE "Group" ALTER COLUMN "adminId" SET NOT NULL;

-- AlterTable Message: thêm isSystem, systemText; cho phép ciphertext/iv/aad null
ALTER TABLE "Message"
  ALTER COLUMN "ciphertext" DROP NOT NULL,
  ALTER COLUMN "iv"         DROP NOT NULL,
  ALTER COLUMN "aad"        DROP NOT NULL,
  ADD COLUMN "isSystem"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "systemText" TEXT;

-- Index mới để load system messages theo nhóm nhanh hơn
CREATE INDEX "Message_groupId_isSystem_createdAt_idx"
  ON "Message" ("groupId", "isSystem", "createdAt" DESC);
