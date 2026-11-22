BEGIN;

CREATE TABLE IF NOT EXISTS project_pages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_page_id BIGINT,
    title VARCHAR(200) NOT NULL CHECK (btrim(title) <> ''),
    content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, id),
    CHECK (parent_page_id <> id),
    FOREIGN KEY (project_id, parent_page_id) REFERENCES project_pages(project_id, id)
);

CREATE INDEX IF NOT EXISTS project_pages_parent_idx ON project_pages(project_id, parent_page_id, id);

COMMIT;
