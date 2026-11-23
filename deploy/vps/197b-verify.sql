\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $check$
DECLARE
    member_id bigint;
    fixture_actor bigint;
    fixture_project bigint;
    fixture_task bigint;
    fixture_comment bigint;
    fixture_storage uuid := gen_random_uuid();
BEGIN
    IF current_database() <> 'teamflow_staging'
       OR session_user <> 'teamflow_staging_app'
       OR current_user <> session_user THEN
        RAISE EXCEPTION 'Connect directly as the staging app role';
    END IF;

    INSERT INTO users (name, email, password, created_at)
    VALUES ('Permission check', gen_random_uuid() || '@example.invalid', 'fixture-only', LOCALTIMESTAMP)
    RETURNING id INTO fixture_actor;
    INSERT INTO users (name, email, password, created_at)
    VALUES ('Permission check', gen_random_uuid() || '@example.invalid', 'fixture-only', LOCALTIMESTAMP)
    RETURNING id INTO member_id;
    PERFORM id FROM users WHERE id = member_id FOR NO KEY UPDATE;
    UPDATE users SET account_status = 'SUSPENDED', access_revision = access_revision + 1
        WHERE id = member_id;
    INSERT INTO admin_member_audit (actor_id, target_id, from_status, to_status, target_revision, reason)
        VALUES (fixture_actor, member_id, 'ACTIVE', 'SUSPENDED', 1, 'Permission check');

    INSERT INTO projects (name, owner_id) VALUES ('Permission check', fixture_actor) RETURNING id INTO fixture_project;
    INSERT INTO project_members (project_id, user_id, status) VALUES (fixture_project, member_id, 'PENDING');
    UPDATE project_members SET status = 'ACCEPTED' WHERE project_id = fixture_project;
    INSERT INTO tasks (project_id, title, due_date, assignee_id)
        VALUES (fixture_project, 'Permission check', CURRENT_DATE, member_id) RETURNING id INTO fixture_task;
    INSERT INTO task_activities (project_id, task_id, task_title, type, actor_id, actor_name, created_at)
        VALUES (fixture_project, fixture_task, 'Permission check', 'TASK_CREATED', fixture_actor, 'Fixture', now());
    INSERT INTO task_comments (task_id, author_id, content, created_at)
        VALUES (fixture_task, fixture_actor, 'Fixture', now()) RETURNING id INTO fixture_comment;
    INSERT INTO task_comments (task_id, author_id, parent_comment_id, content, created_at)
        VALUES (fixture_task, member_id, fixture_comment, 'Reply', now());
    INSERT INTO task_checklist_items (task_id, title) VALUES (fixture_task, 'Fixture');
    INSERT INTO task_attachments (task_id, uploader_id, display_name, storage_key, content_type, size_bytes, created_at)
        VALUES (fixture_task, fixture_actor, 'fixture.txt', fixture_storage, 'text/plain', 1, now());
    INSERT INTO attachment_file_deletions (storage_key, next_attempt_at) VALUES (fixture_storage, now());
    DELETE FROM attachment_file_deletions WHERE storage_key = fixture_storage;
    INSERT INTO notifications (recipient_id, task_id, kind) VALUES (member_id, fixture_task, 'ASSIGNMENT');
    UPDATE notifications SET read_at = now() WHERE task_id = fixture_task;
    INSERT INTO project_pages (project_id, title) VALUES (fixture_project, 'Fixture');
    UPDATE project_pages SET content = 'Fixture' WHERE project_id = fixture_project;
    DELETE FROM tasks WHERE id = fixture_task;
    IF EXISTS (SELECT FROM task_comments WHERE task_id = fixture_task)
       OR EXISTS (SELECT FROM task_attachments WHERE task_id = fixture_task) THEN
        RAISE EXCEPTION 'Task cleanup did not cascade';
    END IF;
    DELETE FROM projects WHERE id = fixture_project;

    IF has_table_privilege(current_user, 'admin_member_audit', 'UPDATE, DELETE, TRUNCATE')
       OR has_column_privilege(current_user, 'users', 'role', 'INSERT, UPDATE')
       OR has_table_privilege(current_user, 'users', 'DELETE, TRUNCATE')
       OR has_database_privilege(current_user, current_database(), 'CREATE, TEMPORARY')
       OR has_database_privilege(current_user, 'postgres', 'CONNECT')
       OR has_schema_privilege(current_user, 'public', 'CREATE')
       OR pg_has_role(current_user, 'teamflow_staging_owner', 'MEMBER') THEN
        RAISE EXCEPTION 'The app role has unexpected privileges';
    END IF;

    BEGIN
        UPDATE users SET role = 'ADMIN' WHERE id = member_id;
        RAISE EXCEPTION 'Role update unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        CREATE TABLE public.teamflow_permission_check (id bigint);
        RAISE EXCEPTION 'CREATE TABLE unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        DELETE FROM admin_member_audit WHERE target_id = member_id;
        RAISE EXCEPTION 'Audit deletion unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END
$check$;

ROLLBACK;
