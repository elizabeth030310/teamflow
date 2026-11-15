ALTER TABLE task_activities
    DROP CONSTRAINT IF EXISTS task_activities_type_check,
    ADD CONSTRAINT task_activities_type_check
        CHECK (type IN ('TASK_CREATED', 'TASK_STATUS_CHANGED', 'TASK_ASSIGNEE_CHANGED',
                        'COMMENT_CREATED', 'COMMENT_DELETED'));
