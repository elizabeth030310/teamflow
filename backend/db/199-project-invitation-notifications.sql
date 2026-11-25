BEGIN;

ALTER TABLE notifications
    ALTER COLUMN task_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS actor_name TEXT,
    ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT,
    ADD COLUMN IF NOT EXISTS reply_comment_id BIGINT,
    ADD COLUMN IF NOT EXISTS invitation_id BIGINT UNIQUE REFERENCES project_members (id) ON DELETE CASCADE,
    DROP CONSTRAINT IF EXISTS notifications_kind_check,
    ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('ASSIGNMENT', 'COMMENT', 'COMMENT_REPLY', 'DUE_SOON', 'OVERDUE', 'PROJECT_INVITATION')),
    DROP CONSTRAINT IF EXISTS notifications_target_check,
    ADD CONSTRAINT notifications_target_check CHECK (
        (kind = 'PROJECT_INVITATION' AND invitation_id IS NOT NULL AND task_id IS NULL)
        OR (kind <> 'PROJECT_INVITATION' AND task_id IS NOT NULL AND invitation_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
    ON notifications (recipient_id, created_at DESC, id DESC);

COMMIT;
