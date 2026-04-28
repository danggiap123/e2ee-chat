-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "fingerprintVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "ekPub" TEXT,
ADD COLUMN     "opkId" TEXT;
