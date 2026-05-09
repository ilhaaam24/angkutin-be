-- DropForeignKey
ALTER TABLE "order_ai_results" DROP CONSTRAINT "order_ai_results_order_id_fkey";

-- AlterTable
ALTER TABLE "order_ai_results" ALTER COLUMN "order_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "order_ai_results" ADD CONSTRAINT "order_ai_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
