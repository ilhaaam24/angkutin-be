-- CreateTable
CREATE TABLE "user_payment_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "user_payment_accounts" ADD CONSTRAINT "user_payment_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
