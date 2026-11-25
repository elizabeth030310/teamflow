BEGIN;

CREATE TABLE public.teamflow_page_uploads (
    user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    project_id bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    upload_id uuid NOT NULL UNIQUE,
    content text NOT NULL DEFAULT '',
    next_part integer NOT NULL DEFAULT 0 CHECK (next_part BETWEEN 0 AND 24),
    expires_at timestamptz NOT NULL,
    CHECK (char_length(content) <= 6000000 AND octet_length(content) <= 24000000)
);
CREATE INDEX teamflow_page_uploads_expiry_idx ON public.teamflow_page_uploads (expires_at);

COMMIT;
