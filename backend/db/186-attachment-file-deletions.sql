CREATE TABLE attachment_file_deletions (
    storage_key UUID PRIMARY KEY,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_attachment_file_deletions_next_attempt ON attachment_file_deletions (next_attempt_at);
