BEGIN;

ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT,
    ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_task_comments_parent ON task_comments (parent_comment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_comments_task_id_id ON task_comments (task_id, id);

ALTER TABLE task_comments
    DROP CONSTRAINT IF EXISTS fk_task_comments_same_task_parent,
    ADD CONSTRAINT fk_task_comments_same_task_parent
        FOREIGN KEY (task_id, parent_comment_id) REFERENCES task_comments (task_id, id);

COMMIT;
