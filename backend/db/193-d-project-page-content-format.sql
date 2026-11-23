BEGIN;

ALTER TABLE project_pages
    ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'plain',
    DROP CONSTRAINT IF EXISTS project_pages_content_check;

ALTER TABLE project_pages
    ADD CONSTRAINT project_pages_content_check CHECK (
        (content_format = 'plain' AND char_length(content) <= 100000)
        OR (content_format = 'rich-v1' AND char_length(content) <= 6000000)
    );

COMMIT;
