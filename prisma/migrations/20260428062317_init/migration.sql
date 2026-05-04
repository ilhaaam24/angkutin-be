-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'COURIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTOR', 'PICKUP', 'TRUCK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'MATCHED', 'ON_GOING', 'ARRIVED', 'WEIGHING', 'WAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'REASSIGNING');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('INSTANT', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletReferenceType" AS ENUM ('ORDER', 'WITHDRAWAL', 'PAYMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('USER', 'COURIER', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "phone" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "latitude" DECIMAL NOT NULL,
    "longitude" DECIMAL NOT NULL,
    "address_detail" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "current_lat" DECIMAL,
    "current_lng" DECIMAL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "courier_id" UUID,
    "address_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "schedule_type" "ScheduleType" NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "note" TEXT,
    "total_credit" DOUBLE PRECISION,
    "total_debit" DOUBLE PRECISION,
    "net_total" DOUBLE PRECISION,
    "payment_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ai_results" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "volume_estimation" DOUBLE PRECISION,
    "object_detected" JSONB,
    "recommended_vehicle" TEXT,
    "confidence_score" DOUBLE PRECISION,

    CONSTRAINT "order_ai_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tracking_logs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "latitude" DECIMAL NOT NULL,
    "longitude" DECIMAL NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_tracking_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "waste_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_waste_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "waste_type_id" UUID NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "order_waste_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_residuals" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "price_per_kg" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "photo_url" TEXT,

    CONSTRAINT "order_residuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference_type" "WalletReferenceType" NOT NULL,
    "reference_id" UUID,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "failure_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "gateway_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "invoice_url" TEXT,
    "expired_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_logs" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_reassignments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "old_courier_id" UUID,
    "new_courier_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_reassignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cancellations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cancelled_by" "CancelledBy" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_waste" (
    "id" UUID NOT NULL,
    "waste_type_id" UUID NOT NULL,
    "price_per_kg" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_waste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_residual" (
    "id" UUID NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "price_per_kg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pricing_residual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_validations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "qr_code" TEXT NOT NULL,
    "scanned_by" UUID NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'VALID',

    CONSTRAINT "terminal_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_external_id_key" ON "payments"("external_id");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ai_results" ADD CONSTRAINT "order_ai_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tracking_logs" ADD CONSTRAINT "order_tracking_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tracking_logs" ADD CONSTRAINT "order_tracking_logs_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_waste_items" ADD CONSTRAINT "order_waste_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_waste_items" ADD CONSTRAINT "order_waste_items_waste_type_id_fkey" FOREIGN KEY ("waste_type_id") REFERENCES "waste_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_residuals" ADD CONSTRAINT "order_residuals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignments" ADD CONSTRAINT "order_reassignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignments" ADD CONSTRAINT "order_reassignments_old_courier_id_fkey" FOREIGN KEY ("old_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignments" ADD CONSTRAINT "order_reassignments_new_courier_id_fkey" FOREIGN KEY ("new_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_waste" ADD CONSTRAINT "pricing_waste_waste_type_id_fkey" FOREIGN KEY ("waste_type_id") REFERENCES "waste_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_validations" ADD CONSTRAINT "terminal_validations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_validations" ADD CONSTRAINT "terminal_validations_scanned_by_fkey" FOREIGN KEY ("scanned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
