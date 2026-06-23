-- Xóa cột fingerprintVerified khỏi Conversation
-- PeerVerification là nguồn sự thật duy nhất cho trạng thái xác minh fingerprint
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "fingerprintVerified";
