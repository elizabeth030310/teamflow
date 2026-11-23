BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS access_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE users
    ALTER COLUMN account_status SET DEFAULT 'ACTIVE',
    ALTER COLUMN account_status SET NOT NULL,
    ALTER COLUMN access_revision SET DEFAULT 0,
    ALTER COLUMN access_revision SET NOT NULL,
    ADD CONSTRAINT users_account_status_domain CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
    ADD CONSTRAINT users_access_revision_nonnegative CHECK (access_revision >= 0);

CREATE UNIQUE INDEX users_single_admin_role_idx ON users (role) WHERE role = 'ADMIN';

CREATE TABLE IF NOT EXISTS admin_member_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id BIGINT NOT NULL REFERENCES users(id),
    target_id BIGINT NOT NULL REFERENCES users(id),
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    target_revision BIGINT NOT NULL,
    reason VARCHAR(300) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (actor_id <> target_id),
    UNIQUE (target_id, target_revision)
);

COMMIT;
