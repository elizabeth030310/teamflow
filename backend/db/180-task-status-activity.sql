ALTER TABLE task_activities
    ADD COLUMN IF NOT EXISTS previous_status varchar(20),
    ADD COLUMN IF NOT EXISTS new_status varchar(20),
    DROP CONSTRAINT IF EXISTS task_activities_type_check,
    ADD CONSTRAINT task_activities_type_check
        CHECK (type IN ('TASK_CREATED', 'TASK_STATUS_CHANGED'));
