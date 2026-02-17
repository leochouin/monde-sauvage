-- Force PostgREST to reload schema cache after recent migrations
NOTIFY pgrst, 'reload schema';
