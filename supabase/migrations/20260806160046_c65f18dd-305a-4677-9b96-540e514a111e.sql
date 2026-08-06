CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('ingest-auto-pump') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-auto-pump');

SELECT cron.schedule(
  'ingest-auto-pump',
  '* * * * *',
  $$ SELECT extensions.net.http_get(
       url := 'https://project--e1e099e5-ccdc-41ee-a7f2-492f7a2f6638-dev.lovable.app/api/public/cron',
       timeout_milliseconds := 55000
     ) $$
);