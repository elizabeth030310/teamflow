CREATE UNIQUE INDEX IF NOT EXISTS users_non_withdrawn_email_idx
    ON public.users (lower(email)) WHERE account_status <> 'WITHDRAWN';
