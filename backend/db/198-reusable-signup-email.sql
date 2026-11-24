BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE;

CREATE UNIQUE INDEX users_non_withdrawn_email_idx
    ON public.users (lower(email)) WHERE account_status <> 'WITHDRAWN';

DO $migration$
DECLARE
    old_unique record;
BEGIN
    FOR old_unique IN
        SELECT index_relation.relname AS index_name, email_constraint.conname AS constraint_name
        FROM pg_catalog.pg_index AS indexed
        JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = indexed.indexrelid
        JOIN pg_catalog.pg_attribute AS email_column
          ON email_column.attrelid = indexed.indrelid AND email_column.attname = 'email'
        LEFT JOIN pg_catalog.pg_constraint AS email_constraint
          ON email_constraint.conrelid = indexed.indrelid
         AND email_constraint.conindid = indexed.indexrelid
         AND email_constraint.contype = 'u'
        WHERE indexed.indrelid = 'public.users'::regclass
          AND indexed.indisunique AND NOT indexed.indisprimary
          AND indexed.indnatts = 1 AND indexed.indkey[0] = email_column.attnum
          AND indexed.indpred IS NULL AND indexed.indexprs IS NULL
    LOOP
        IF old_unique.constraint_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', old_unique.constraint_name);
        ELSE
            EXECUTE format('DROP INDEX public.%I', old_unique.index_name);
        END IF;
    END LOOP;
END
$migration$;
COMMIT;
