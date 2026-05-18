/*
  Warnings:

  - The `opkPubs` column on the `KeyBundle` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "KeyBundle" DROP COLUMN "opkPubs",
ADD COLUMN     "opkPubs" JSONB[];
