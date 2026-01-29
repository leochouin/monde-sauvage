-- Create a storage bucket for chalet images
insert into storage.buckets (id, name, public)
values ('chalet-images', 'chalet-images', true);

-- Set up storage policies for chalet images
create policy "Allow public read access to chalet images"
on storage.objects for select
using ( bucket_id = 'chalet-images' );

create policy "Allow authenticated users to upload chalet images"
on storage.objects for insert
with check ( 
    bucket_id = 'chalet-images' 
    and auth.role() = 'authenticated'
);

create policy "Allow authenticated users to update their chalet images"
on storage.objects for update
using ( 
    bucket_id = 'chalet-images' 
    and auth.role() = 'authenticated'
);

create policy "Allow authenticated users to delete their chalet images"
on storage.objects for delete
using ( 
    bucket_id = 'chalet-images' 
    and auth.role() = 'authenticated'
);
