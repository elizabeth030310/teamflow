BEGIN;

CREATE TABLE public.teamflow_attachment_uploads (
    storage_key uuid PRIMARY KEY,
    task_id bigint NOT NULL,
    uploader_id bigint NOT NULL,
    display_name varchar(255) NOT NULL,
    content_type varchar(100) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    expires_at timestamptz NOT NULL
);
CREATE INDEX teamflow_attachment_uploads_expiry_idx ON public.teamflow_attachment_uploads (expires_at);
CREATE INDEX teamflow_attachment_uploads_uploader_idx ON public.teamflow_attachment_uploads (uploader_id, expires_at);

COMMIT;
