BEGIN;

CREATE TABLE IF NOT EXISTS signup_verifications (
    email_key varchar(64) PRIMARY KEY,
    salt uuid NOT NULL,
    code_mac bytea,
    expires_at timestamptz NOT NULL,
    resend_at timestamptz NOT NULL,
    failed_attempts integer NOT NULL CHECK (failed_attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS signup_verifications_expiry_idx ON signup_verifications (expires_at);

CREATE TABLE IF NOT EXISTS signup_send_limits (
    scope_key varchar(72) PRIMARY KEY,
    window_ends_at timestamptz NOT NULL,
    sends integer NOT NULL CHECK (sends > 0)
);

CREATE INDEX IF NOT EXISTS signup_send_limits_expiry_idx ON signup_send_limits (window_ends_at);

COMMIT;
