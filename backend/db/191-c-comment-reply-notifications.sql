BEGIN;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS actor_name TEXT,
    ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT,
    ADD COLUMN IF NOT EXISTS reply_comment_id BIGINT,
    DROP CONSTRAINT IF EXISTS notifications_kind_check,
    ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('ASSIGNMENT', 'COMMENT', 'COMMENT_REPLY', 'DUE_SOON', 'OVERDUE'));

COMMIT;
