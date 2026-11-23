$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '../vps/197b-bootstrap.sql'
$stagingSql = [IO.File]::ReadAllText($source).Replace("`r`n", "`n")
$start = $stagingSql.IndexOf('CREATE TABLE users (', [StringComparison]::Ordinal)
$end = $stagingSql.IndexOf('GRANT CONNECT ON DATABASE teamflow_staging TO teamflow_staging_app;', [StringComparison]::Ordinal)
if ($start -lt 0 -or $end -le $start -or !$stagingSql.TrimEnd().EndsWith('COMMIT;')) {
    throw 'The staging SQL layout changed. Review the public bootstrap before using it.'
}

$guard = @'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(197, 2);

DO $bootstrap$
BEGIN
    IF current_database() <> 'teamflow_public'
       OR session_user <> current_user
       OR NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database() AND datdba = current_user::regrole)
       OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
        RAISE EXCEPTION 'Use the owner of the dedicated PostgreSQL 16 teamflow_public database';
    END IF;

    IF EXISTS (SELECT FROM pg_depend WHERE refclassid = 'pg_namespace'::regclass
               AND refobjid = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'The public schema must be empty';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'teamflow_public_app' AND rolcanlogin
                   AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolinherit))
       OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'teamflow_public_app'::regrole) THEN
        RAISE EXCEPTION 'Create teamflow_public_app with LOGIN NOINHERIT and no role memberships';
    END IF;
END
$bootstrap$;

REVOKE ALL ON DATABASE teamflow_public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
'@

$guard
$stagingSql.Substring($start).Replace('teamflow_staging_app', 'teamflow_public_app').Replace('DATABASE teamflow_staging ', 'DATABASE teamflow_public ')
