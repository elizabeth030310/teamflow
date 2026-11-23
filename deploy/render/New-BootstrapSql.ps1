[CmdletBinding()]
param([switch]$Neon)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '../vps/197b-bootstrap.sql'
$stagingSql = [IO.File]::ReadAllText($source).Replace("`r`n", "`n")
$start = $stagingSql.IndexOf('CREATE TABLE users (', [StringComparison]::Ordinal)
$end = $stagingSql.IndexOf('GRANT CONNECT ON DATABASE teamflow_staging TO teamflow_staging_app;', [StringComparison]::Ordinal)
if ($start -lt 0 -or $end -le $start -or !$stagingSql.TrimEnd().EndsWith('COMMIT;')) {
    throw 'The staging SQL layout changed. Review the public bootstrap before using it.'
}

$guard = @'
BEGIN;
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(197, 2);

DO $bootstrap$
BEGIN
    IF current_database() <> '__DATABASE__'
       OR session_user <> current_user
       OR NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database() AND datdba = current_user::regrole)
       OR current_setting('server_version_num')::integer / 10000 <> __MAJOR__ THEN
        RAISE EXCEPTION 'Use the owner of the dedicated PostgreSQL __MAJOR__ __DATABASE__ database';
    END IF;

    IF EXISTS (
        SELECT FROM pg_catalog.pg_depend
        WHERE refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
          AND refobjid = 'public'::pg_catalog.regnamespace
          AND classid <> 'pg_catalog.pg_default_acl'::pg_catalog.regclass
    ) THEN
        RAISE EXCEPTION 'The public schema must be empty';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'teamflow_public_app' AND rolcanlogin
                   AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolinherit))
       OR EXISTS (SELECT FROM pg_auth_members WHERE member = to_regrole('teamflow_public_app')) THEN
        RAISE EXCEPTION 'Create teamflow_public_app with LOGIN NOINHERIT and no role memberships';
    END IF;
END
$bootstrap$;

REVOKE ALL ON DATABASE __DATABASE__ FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
'@

$database = if ($Neon) { 'neondb' } else { 'teamflow_public' }
$major = if ($Neon) { '18' } else { '16' }
$schemaSql = $stagingSql.Substring($start).Replace('teamflow_staging_app', 'teamflow_public_app').Replace('DATABASE teamflow_staging ', "DATABASE $database ")

if (!$Neon) {
    '\set ON_ERROR_STOP on'
}
$guard.Replace('__DATABASE__', $database).Replace('__MAJOR__', $major)
if (!$Neon) {
    $schemaSql
    return
}

$schemaSql.Substring(0, $schemaSql.LastIndexOf('COMMIT;', [StringComparison]::Ordinal))
@'
DO $privileges$
BEGIN
    IF NOT has_database_privilege('teamflow_public_app', current_database(), 'CONNECT')
       OR NOT has_schema_privilege('teamflow_public_app', 'public', 'USAGE')
       OR has_database_privilege('teamflow_public_app', current_database(), 'CREATE, TEMPORARY')
       OR has_schema_privilege('teamflow_public_app', 'public', 'CREATE')
       OR has_column_privilege('teamflow_public_app', 'public.users', 'role', 'INSERT, UPDATE')
       OR has_table_privilege('teamflow_public_app', 'public.users', 'DELETE, TRUNCATE')
       OR has_table_privilege('teamflow_public_app', 'public.admin_member_audit', 'UPDATE, DELETE, TRUNCATE') THEN
        RAISE EXCEPTION 'Unexpected TeamFlow runtime privileges. Bootstrap rolled back.';
    END IF;
END
$privileges$;

COMMIT;
'@
