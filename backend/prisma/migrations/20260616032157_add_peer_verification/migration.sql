-- CreateTable
CREATE TABLE "PeerVerification" (
    "id" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeerVerification_verifierId_idx" ON "PeerVerification"("verifierId");

-- CreateIndex
CREATE UNIQUE INDEX "PeerVerification_verifierId_peerId_key" ON "PeerVerification"("verifierId", "peerId");

-- AddForeignKey
ALTER TABLE "PeerVerification" ADD CONSTRAINT "PeerVerification_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerVerification" ADD CONSTRAINT "PeerVerification_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
