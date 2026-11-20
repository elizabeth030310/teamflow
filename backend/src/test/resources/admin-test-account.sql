INSERT INTO users (id, name, email, password, role, created_at, account_status, access_revision)
VALUES (3, 'Test administrator', 'admin-fixture@example.test', 'fixture-disabled', 'ADMIN', CURRENT_TIMESTAMP, 'ACTIVE', 0)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST(3, MAX(id))) FROM users;
