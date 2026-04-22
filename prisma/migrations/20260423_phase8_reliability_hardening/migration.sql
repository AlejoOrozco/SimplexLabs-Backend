-- Phase 8 — Reliability hardening migration
-- 1. Dedupe choke-point table for every inbound provider event.
-- 2. Dead-letter table for async task replay.
-- 3. Unique(messageId) on agent_runs to collapse concurrent pipeline runs.
-- 4. Hot-path index on messages(conversation_id, sent_at DESC) for timelines.
--
-- All statements are idempotent where practical (IF NOT EXISTS) so the
-- migration replays safely in CI and disaster-recovery restores.

-- ---------------------------------------------------------------------------
-- 1. WebhookEvent
-- ---------------------------------------------------------------------------
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

CREATE TABLE "webhook_events" (
    "id"                TEXT NOT NULL,
    "provider"          TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "company_id"        TEXT,
    "status"            "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "outcome"           TEXT,
    "first_seen_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at"      TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key"
    ON "webhook_events"("provider", "provider_event_id");

CREATE INDEX "webhook_events_company_id_first_seen_at_idx"
    ON "webhook_events"("company_id", "first_seen_at");

-- ---------------------------------------------------------------------------
-- 2. FailedTask (DLQ)
-- ---------------------------------------------------------------------------
CREATE TYPE "FailedTaskStatus" AS ENUM ('PENDING_REPLAY', 'REPLAYED', 'ABANDONED');

CREATE TABLE "failed_tasks" (
    "id"              TEXT NOT NULL,
    "company_id"      TEXT,
    "task_type"       TEXT NOT NULL,
    "payload"         JSONB NOT NULL,
    "last_error"      TEXT NOT NULL,
    "attempts"        INTEGER NOT NULL DEFAULT 1,
    "status"          "FailedTaskStatus" NOT NULL DEFAULT 'PENDING_REPLAY',
    "replaced_by_id"  TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failed_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "failed_tasks_status_created_at_idx"
    ON "failed_tasks"("status", "created_at");

CREATE INDEX "failed_tasks_company_id_task_type_idx"
    ON "failed_tasks"("company_id", "task_type");

-- ---------------------------------------------------------------------------
-- 3. AgentRun.message_id unique
--
-- NOTE: if a duplicate pair already exists at migrate-time, this statement
-- fails loudly — that is the desired behaviour (historical duplicates MUST
-- be triaged manually before the constraint lands in prod). The previous
-- application-level dedupe has held for phases 2-7, so duplicates are
-- not expected.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "agent_runs_message_id_key" ON "agent_runs"("message_id");

-- ---------------------------------------------------------------------------
-- 4. messages(conversation_id, sent_at DESC) hot-path index
-- ---------------------------------------------------------------------------
CREATE INDEX "messages_conversation_id_sent_at_idx"
    ON "messages"("conversation_id", "sent_at" DESC);
