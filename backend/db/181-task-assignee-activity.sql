ALTER TABLE task_activities
    ADD COLUMN IF NOT EXISTS previous_assignee_id bigint,
    ADD COLUMN IF NOT EXISTS new_assignee_id bigint,
    DROP CONSTRAINT IF EXISTS task_activities_type_check,
    ADD CONSTRAINT task_activities_type_check
        CHECK (type IN ('TASK_CREATED', 'TASK_STATUS_CHANGED', 'TASK_ASSIGNEE_CHANGED'));
