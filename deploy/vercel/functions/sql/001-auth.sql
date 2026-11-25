BEGIN;

CREATE TABLE public.teamflow_sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    access_revision bigint NOT NULL CHECK (access_revision >= 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX teamflow_sessions_expiry_idx ON public.teamflow_sessions (expires_at);
CREATE INDEX teamflow_sessions_user_idx ON public.teamflow_sessions (user_id);

CREATE TABLE public.teamflow_login_limits (
    scope text NOT NULL CHECK (scope IN ('global', 'address', 'account')),
    bucket text NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0),
    PRIMARY KEY (scope, bucket)
);
CREATE TABLE public.teamflow_login_window (
    singleton boolean PRIMARY KEY CHECK (singleton),
    expires_at timestamptz NOT NULL
);
INSERT INTO public.teamflow_login_window VALUES (true, clock_timestamp());

COMMIT;
