-- FERD files may be up to 2 GB each (was 50 MB). The project's global upload limit (Storage settings) still
-- applies on top of this: on the Supabase Free plan every upload stops at 50 MB whatever the bucket allows.
update storage.buckets set file_size_limit = 2147483648 where id = 'ferd-files';
