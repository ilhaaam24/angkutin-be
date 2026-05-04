-- AlterTable
ALTER TABLE "users" ADD COLUMN     "otp_code" TEXT,
ADD COLUMN     "otp_expires_at" TIMESTAMP(3),
ADD COLUMN     "refresh_token" TEXT;
