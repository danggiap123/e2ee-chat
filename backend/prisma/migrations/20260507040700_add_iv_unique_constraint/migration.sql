-- Thêm unique constraint: IV phải duy nhất trong mỗi conversation
-- Mục đích: chống replay attack — nếu IV trùng thì đây là gói tin bị gửi lại
CREATE UNIQUE INDEX "Message_conversationId_iv_key" ON "Message"("conversationId", "iv");
