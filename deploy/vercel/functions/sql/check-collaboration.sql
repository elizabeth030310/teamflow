BEGIN READ ONLY;

WITH check_targets(schema_name, table_name, column_name, privilege) AS (
    VALUES
        ('public', 'project_pages', 'content_format', 'INSERT'),
        ('public', 'project_pages', 'content_format', 'UPDATE'),
        ('public', 'notifications', 'invitation_id', 'INSERT'),
        ('public', 'notifications', 'created_at', 'UPDATE'),
        ('public', 'teamflow_page_uploads', 'content', 'INSERT')
)
SELECT targets.table_name, targets.column_name, targets.privilege,
       relation.oid IS NOT NULL AS table_present,
       attribute.attnum IS NOT NULL AS column_present,
       CASE WHEN attribute.attnum IS NOT NULL
            THEN has_column_privilege(current_user, relation.oid, attribute.attnum, targets.privilege)
            ELSE false END AS granted
FROM check_targets targets
LEFT JOIN pg_namespace namespace ON namespace.nspname = targets.schema_name
LEFT JOIN pg_class relation ON relation.relnamespace = namespace.oid AND relation.relname = targets.table_name
LEFT JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attname = targets.column_name
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
ORDER BY targets.table_name, targets.column_name, targets.privilege;

COMMIT;
