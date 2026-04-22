-- CreateEnum
CREATE TYPE "ConversationControlMode" AS ENUM ('AGENT', 'HUMAN');

-- CreateEnum
CREATE TYPE "ConversationLifecycleStatus" AS ENUM ('NEW', 'AGENT_ANALYZING', 'INTERESTED', 'APPOINTMENT_PENDING', 'APPOINTMENT_BOOKED', 'ORDER_PLACED', 'PAYMENT_INITIATED', 'PAYMENT_PENDING_REVIEW', 'PAYMENT_CONFIRMED', 'NEEDS_ATTENTION', 'AGENT_REPLIED_WAITING', 'AUTO_CLOSED_INACTIVE', 'CLOSED_BY_CLIENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'WIRE_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'AWAITING_SCREENSHOT', 'PENDING_REVIEW', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_REQUESTED', 'PAYMENT_SCREENSHOT_RECEIVED', 'AGENT_NEEDS_ATTENTION', 'ORDER_PLACED', 'PIPELINE_FAILED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'EMPLOYEE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentRole" ADD VALUE 'DECIDER';
ALTER TYPE "AgentRole" ADD VALUE 'EXECUTOR';

-- AlterEnum
ALTER TYPE "SenderType" ADD VALUE 'HUMAN';

-- DropIndex
DROP INDEX "conversations_contact_id_channel_key";

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "decider_input" JSONB,
ADD COLUMN     "decider_output" JSONB,
ADD COLUMN     "executor_input" JSONB,
ADD COLUMN     "executor_output" JSONB;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "staff_id" TEXT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "control_mode" "ConversationControlMode" NOT NULL DEFAULT 'AGENT',
ADD COLUMN     "control_mode_changed_at" TIMESTAMP(3),
ADD COLUMN     "controlled_by_user_id" TEXT,
ADD COLUMN     "last_agent_message_at" TIMESTAMP(3),
ADD COLUMN     "last_customer_message_at" TIMESTAMP(3),
ADD COLUMN     "lifecycle_status" "ConversationLifecycleStatus" NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "company_channels" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "business_account_id" TEXT,
    "encrypted_access_token" TEXT NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL DEFAULT 'EMPLOYEE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_times" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocked_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "order_id" TEXT,
    "conversation_id" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "wire_screenshot_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "prev_status" "PaymentStatus",
    "new_status" "PaymentStatus" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "provider_ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "default_slot_duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "inactivity_close_hours" INTEGER NOT NULL DEFAULT 48,
    "stripe_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wire_transfer_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wire_transfer_instructions" TEXT,
    "notification_email" TEXT,
    "notification_whatsapp" TEXT,
    "in_app_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_channels_company_id_channel_idx" ON "company_channels"("company_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "company_channels_channel_external_id_key" ON "company_channels"("channel", "external_id");

-- CreateIndex
CREATE INDEX "staff_company_id_is_active_idx" ON "staff"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_staff_id_day_of_week_start_time_key" ON "working_hours"("staff_id", "day_of_week", "start_time");

-- CreateIndex
CREATE INDEX "blocked_times_company_id_starts_at_ends_at_idx" ON "blocked_times"("company_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "blocked_times_staff_id_starts_at_ends_at_idx" ON "blocked_times"("staff_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "payments_company_id_status_idx" ON "payments"("company_id", "status");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_created_at_idx" ON "payment_events"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_company_id_read_at_idx" ON "notifications"("company_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_company_id_created_at_idx" ON "notifications"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_company_id_key" ON "company_settings"("company_id");

-- CreateIndex
CREATE INDEX "appointments_company_id_scheduled_at_idx" ON "appointments"("company_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_staff_id_scheduled_at_idx" ON "appointments"("staff_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "conversations_contact_id_channel_status_idx" ON "conversations"("contact_id", "channel", "status");

-- CreateIndex
CREATE INDEX "conversations_company_id_lifecycle_status_idx" ON "conversations"("company_id", "lifecycle_status");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_controlled_by_user_id_fkey" FOREIGN KEY ("controlled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_channels" ADD CONSTRAINT "company_channels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_times" ADD CONSTRAINT "blocked_times_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_times" ADD CONSTRAINT "blocked_times_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
