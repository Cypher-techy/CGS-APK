-- Community chat: two independent communities, 'cgs' (approved Cypher Green Systems members) and 'ferd'
-- (verified FERD students and FERD staff). Every channel and message belongs to exactly one community.
--
-- Access is never stored as a copy of someone's standing. A membership row records that a person joined;
-- whether they may read or write is decided at the moment of each request from the existing rules:
--   cgs  : an active CGS account (private.user_role() is not null)
--   ferd : a verified student (private.ferd_is_student()) or FERD staff (private.ferd_role() is not null)
-- so suspending an account or a student closes the chat at once, and membership of one community says
-- nothing about the other. All writes go through the functions below; tables grant SELECT only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.community_settings (
  community text primary key check (community in ('cgs', 'ferd')),
  require_approval boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.community_settings (community) values ('cgs'), ('ferd');

create table public.community_members (
  community text not null references public.community_settings (community),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator')),
  status text not null default 'active' check (status in ('pending', 'active', 'removed')),
  muted_until timestamptz,
  show_presence boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

create table public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community text not null references public.community_settings (community),
  kind text not null check (kind in ('public', 'announcement', 'project', 'department')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  project_id uuid references public.projects (id) on delete cascade,
  department_id uuid references public.ferd_departments (id) on delete cascade,
  sort_order integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (community, slug),
  unique (id, community),
  constraint community_channels_project_check check ((kind = 'project') = (project_id is not null)),
  constraint community_channels_department_check check ((kind = 'department') = (department_id is not null)),
  -- Project discussions exist only in the CGS community, department rooms only in the FERD community.
  constraint community_channels_scope_check check ((kind <> 'project' or community = 'cgs') and (kind <> 'department' or community = 'ferd'))
);
create unique index community_channels_project_idx on public.community_channels (project_id) where project_id is not null;
create unique index community_channels_department_idx on public.community_channels (department_id) where department_id is not null;

create table public.community_messages (
  id uuid primary key default gen_random_uuid(),
  community text not null,
  channel_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  body text check (body is null or char_length(body) <= 4000),
  reply_to uuid,
  -- Summaries kept on the row so that one real-time event carries everything the screen shows.
  attachments jsonb not null default '[]'::jsonb,
  reactions jsonb not null default '{}'::jsonb,
  is_pinned boolean not null default false,
  pinned_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A message's community is its channel's community: the pair must exist in community_channels.
  foreign key (channel_id, community) references public.community_channels (id, community) on delete cascade,
  unique (id, channel_id),
  -- A reply stays inside its channel.
  foreign key (reply_to, channel_id) references public.community_messages (id, channel_id)
);
create index community_messages_channel_idx on public.community_messages (channel_id, created_at desc);
create index community_messages_author_idx on public.community_messages (author_id, created_at desc);
create index community_messages_pinned_idx on public.community_messages (channel_id) where is_pinned;
alter table public.community_messages replica identity full;

create table public.community_reactions (
  message_id uuid not null references public.community_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🌱')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.community_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.community_messages (id) on delete cascade,
  channel_id uuid not null references public.community_channels (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index community_attachments_message_idx on public.community_attachments (message_id);

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  community text not null references public.community_settings (community),
  message_id uuid not null references public.community_messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);
create index community_reports_open_idx on public.community_reports (community, created_at desc) where status = 'open';

-- Per person and channel: what has been read, and whether announcements should notify.
create table public.community_channel_state (
  channel_id uuid not null references public.community_channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  notify text not null default 'all' check (notify in ('all', 'none')),
  primary key (channel_id, user_id)
);

create table public.community_audit (
  id bigint generated always as identity primary key,
  community text not null references public.community_settings (community),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  channel_id uuid,
  message_id uuid,
  target_user uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index community_audit_idx on public.community_audit (community, created_at desc);

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
create function private.chat_eligible(p_community text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_community
    when 'cgs' then private.user_role() is not null
    when 'ferd' then private.ferd_is_student() or private.ferd_role() is not null
    else false end
$$;

create function private.chat_is_admin(p_community text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_community
    when 'cgs' then private.is_admin()
    when 'ferd' then coalesce(private.ferd_role() in ('super_admin', 'department_admin'), false)
    else false end
$$;

-- Whether another person administers a community (used so that moderators cannot act on administrators).
create function private.chat_user_is_admin(p_community text, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.role = 'super_admin' and p.status = 'active')
    or (p_community = 'ferd' and exists (
      select 1 from public.ferd_staff s join public.profiles p on p.id = s.user_id and p.status not in ('suspended', 'terminated')
      where s.user_id = p_user and s.role in ('super_admin', 'department_admin')))
$$;

-- 'admin', 'moderator' or 'member' for the caller in one community; null when they have no access.
create function private.chat_role(p_community text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not private.chat_eligible(p_community) then null
    when private.chat_is_admin(p_community) then 'admin'
    else (select m.role from public.community_members m
          where m.community = p_community and m.user_id = (select auth.uid()) and m.status = 'active')
  end
$$;

create function private.chat_can_moderate(p_community text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.chat_role(p_community) in ('admin', 'moderator'), false)
$$;

create function private.chat_channel_visible(p_community text, p_kind text, p_project uuid, p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.chat_role(p_community) is not null and case p_kind
    when 'project' then private.is_admin() or private.is_participant(p_project, (select auth.uid()))
    when 'department' then private.ferd_role() is not null or coalesce(private.ferd_student_department() = p_department, false)
    else true end
$$;

create function private.chat_can_read(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_channels c
    where c.id = p_channel and private.chat_channel_visible(c.community, c.kind, c.project_id, c.department_id)
      and (c.archived_at is null or private.chat_can_moderate(c.community)))
$$;

create function private.chat_can_post(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.chat_can_read(p_channel) and exists (
    select 1 from public.community_channels c
    where c.id = p_channel and c.archived_at is null
      and (c.kind <> 'announcement' or private.chat_can_moderate(c.community))
      and not exists (select 1 from public.community_members m
                      where m.community = c.community and m.user_id = (select auth.uid()) and m.muted_until > now()))
$$;

-- The name shown beside a message: the verified student's name in FERD, otherwise the profile name.
create function private.chat_name(p_community text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case when p_community = 'ferd' then (select s.full_name from public.ferd_students s where s.user_id = (select auth.uid()) and s.status = 'verified') end,
    (select p.full_name from public.profiles p where p.id = (select auth.uid())))
$$;

-- Channel behind a storage path '<community>/<channel id>/<file>' or a real-time topic 'chat:<channel id>'.
-- Null when the text is malformed or the community in the path is not the channel's own.
create function private.chat_path_channel(p_path text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.community_channels c
  where p_path ~ '^(cgs|ferd)/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
    and c.id = split_part(p_path, '/', 2)::uuid and c.community = split_part(p_path, '/', 1)
$$;

create function private.chat_topic_channel(p_topic text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_topic ~ '^chat:[0-9a-f-]{36}$' then substr(p_topic, 6)::uuid end
$$;

create function private.chat_audit(p_community text, p_action text, p_channel uuid, p_message uuid, p_target uuid, p_details jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.community_audit (community, actor_id, action, channel_id, message_id, target_user, details)
  values (p_community, (select auth.uid()), p_action, p_channel, p_message, p_target, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create function public.community_join(p_community text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null or not coalesce(private.chat_eligible(p_community), false) then
    raise exception 'Your account does not have access to this community';
  end if;
  select status into v_status from public.community_members where community = p_community and user_id = v_uid;
  if found then
    return v_status;
  end if;
  v_status := case when (select require_approval from public.community_settings where community = p_community)
                        and not private.chat_is_admin(p_community) then 'pending' else 'active' end;
  insert into public.community_members (community, user_id, status) values (p_community, v_uid, v_status);
  perform private.chat_audit(p_community, 'member.joined', null, null, v_uid, jsonb_build_object('status', v_status));
  return v_status;
end $$;

create function public.community_member_list(p_community text)
returns table (user_id uuid, name text, role text, status text, muted boolean, department text, show_presence boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(st.full_name, p.full_name),
    case when private.chat_user_is_admin(p_community, m.user_id) then 'admin' else m.role end,
    m.status, coalesce(m.muted_until > now(), false), d.name, m.show_presence
  from public.community_members m
  join public.profiles p on p.id = m.user_id
  left join public.ferd_students st on p_community = 'ferd' and st.user_id = m.user_id and st.status = 'verified'
  left join public.ferd_departments d on d.id = st.department_id
  where m.community = p_community and private.chat_role(p_community) is not null
    and (m.status = 'active' or private.chat_can_moderate(p_community))
  order by 2
$$;

-- approve, remove, restore, mute, unmute: moderators and administrators. make_moderator, make_member: administrators.
create function public.community_moderate_member(p_community text, p_user uuid, p_action text, p_minutes integer default 60) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.chat_role(p_community);
  v_target public.community_members;
begin
  if v_role is null or v_role not in ('admin', 'moderator') then
    raise exception 'Only moderators can do this';
  end if;
  select * into v_target from public.community_members where community = p_community and user_id = p_user;
  if not found then
    raise exception 'This person is not a member of the community';
  end if;
  if p_user = v_uid or private.chat_user_is_admin(p_community, p_user) or (v_role = 'moderator' and v_target.role = 'moderator') then
    raise exception 'You cannot change this member';
  end if;
  if p_action in ('make_moderator', 'make_member') and v_role <> 'admin' then
    raise exception 'Only administrators appoint moderators';
  end if;
  case p_action
    when 'approve' then update public.community_members set status = 'active', updated_at = now() where community = p_community and user_id = p_user and status = 'pending';
    when 'remove' then update public.community_members set status = 'removed', role = 'member', updated_at = now() where community = p_community and user_id = p_user;
    when 'restore' then update public.community_members set status = 'active', updated_at = now() where community = p_community and user_id = p_user and status = 'removed';
    when 'mute' then update public.community_members set muted_until = now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 5), 43200)), updated_at = now() where community = p_community and user_id = p_user;
    when 'unmute' then update public.community_members set muted_until = null, updated_at = now() where community = p_community and user_id = p_user;
    when 'make_moderator' then update public.community_members set role = 'moderator', updated_at = now() where community = p_community and user_id = p_user and status = 'active';
    when 'make_member' then update public.community_members set role = 'member', updated_at = now() where community = p_community and user_id = p_user;
    else raise exception 'Unknown action';
  end case;
  perform private.chat_audit(p_community, 'member.' || p_action, null, null, p_user,
    case when p_action = 'mute' then jsonb_build_object('minutes', p_minutes) else '{}'::jsonb end);
end $$;

create function public.community_set_approval(p_community text, p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.chat_is_admin(p_community) then
    raise exception 'Only administrators change this setting';
  end if;
  update public.community_settings set require_approval = p_required, updated_at = now() where community = p_community;
  perform private.chat_audit(p_community, 'settings.approval', null, null, null, jsonb_build_object('required', p_required));
end $$;

create function public.community_set_presence(p_community text, p_show boolean) returns void
language sql security definer set search_path = '' as $$
  update public.community_members set show_presence = p_show, updated_at = now()
  where community = p_community and user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
create function public.community_channel_list(p_community text)
returns table (id uuid, kind text, slug text, name text, description text, archived boolean, project_id uuid, department_id uuid, can_post boolean, notify text, unread integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.slug, c.name, c.description, c.archived_at is not null, c.project_id, c.department_id,
    private.chat_can_post(c.id), coalesce(s.notify, 'all'),
    (select count(*)::integer from (
       select 1 from public.community_messages m
       where m.channel_id = c.id and m.deleted_at is null and m.author_id is distinct from (select auth.uid())
         and m.created_at > coalesce(s.last_read_at, mem.joined_at, now())
       limit 100) recent)
  from public.community_channels c
  left join public.community_channel_state s on s.channel_id = c.id and s.user_id = (select auth.uid())
  left join public.community_members mem on mem.community = c.community and mem.user_id = (select auth.uid())
  where c.community = p_community
    and private.chat_channel_visible(c.community, c.kind, c.project_id, c.department_id)
    and (c.archived_at is null or private.chat_can_moderate(c.community))
  order by c.sort_order, c.name
$$;

-- Administrators create, rename and archive ordinary and announcement channels.
create function public.community_save_channel(p_community text, p_id uuid, p_name text, p_description text, p_kind text default 'public', p_archived boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 48);
  v_id uuid := p_id;
begin
  if not private.chat_is_admin(p_community) then
    raise exception 'Only administrators manage channels';
  end if;
  if char_length(v_name) not between 2 and 60 or char_length(v_slug) < 2 then
    raise exception 'Give the channel a name of 2 to 60 characters';
  end if;
  if p_id is null then
    if p_kind not in ('public', 'announcement') then
      raise exception 'Choose an ordinary or an announcement channel';
    end if;
    if exists (select 1 from public.community_channels where community = p_community and slug = v_slug) then
      raise exception 'A channel with this name already exists';
    end if;
    insert into public.community_channels (community, kind, slug, name, description, created_by)
    values (p_community, p_kind, v_slug, v_name, nullif(btrim(coalesce(p_description, '')), ''), (select auth.uid()))
    returning id into v_id;
    perform private.chat_audit(p_community, 'channel.created', v_id, null, null, jsonb_build_object('name', v_name, 'kind', p_kind));
  else
    update public.community_channels
    set name = v_name, description = nullif(btrim(coalesce(p_description, '')), ''),
        archived_at = case when p_archived then coalesce(archived_at, now()) end
    where id = p_id and community = p_community;
    if not found then
      raise exception 'Channel not found';
    end if;
    perform private.chat_audit(p_community, case when p_archived then 'channel.archived' else 'channel.updated' end, p_id, null, null, jsonb_build_object('name', v_name));
  end if;
  return v_id;
end $$;

-- Opens (creating it the first time) the discussion of a project, for that project's participants only.
create function public.community_open_project(p_project uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_title text;
begin
  if private.chat_role('cgs') is null or not (private.is_admin() or private.is_participant(p_project, v_uid)) then
    raise exception 'Only members of this project can open its discussion';
  end if;
  select id into v_id from public.community_channels where project_id = p_project;
  if found then
    return v_id;
  end if;
  select name into v_title from public.projects where id = p_project;
  if v_title is null then
    raise exception 'Project not found';
  end if;
  insert into public.community_channels (community, kind, slug, name, description, project_id, sort_order, created_by)
  values ('cgs', 'project', 'project-' || p_project::text, left(v_title, 60), 'Discussion for the members of this project.', p_project, 500, v_uid)
  returning id into v_id;
  perform private.chat_audit('cgs', 'channel.created', v_id, null, null, jsonb_build_object('project', p_project));
  return v_id;
end $$;

-- Projects the caller takes part in, for the "open a project discussion" list.
create function public.community_my_projects() returns table (id uuid, name text, channel_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, c.id
  from public.projects p
  left join public.community_channels c on c.project_id = p.id
  where private.chat_role('cgs') is not null and private.is_participant(p.id, (select auth.uid()))
  order by p.name
$$;

create function public.community_mark_read(p_channel uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.chat_can_read(p_channel) then
    return;
  end if;
  insert into public.community_channel_state (channel_id, user_id, last_read_at) values (p_channel, (select auth.uid()), now())
  on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;

create function public.community_set_notify(p_channel uuid, p_notify text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.chat_can_read(p_channel) or p_notify not in ('all', 'none') then
    raise exception 'This setting could not be saved';
  end if;
  insert into public.community_channel_state (channel_id, user_id, notify) values (p_channel, (select auth.uid()), p_notify)
  on conflict (channel_id, user_id) do update set notify = excluded.notify;
end $$;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
-- p_files: [{"path": "<community>/<channel>/<uuid>.<ext>", "name": "original name"}], already uploaded by the caller.
create function public.community_send(p_channel uuid, p_body text, p_reply_to uuid default null, p_files jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_channel public.community_channels;
  v_body text := nullif(btrim(regexp_replace(coalesce(p_body, ''), E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', 'g')), '');
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  v_id uuid := gen_random_uuid();
  v_file jsonb;
  v_meta jsonb;
  v_summary jsonb := '[]'::jsonb;
begin
  select * into v_channel from public.community_channels where id = p_channel;
  if not found or not private.chat_can_post(p_channel) then
    raise exception 'You cannot post in this channel';
  end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) > 5 then
    raise exception 'Attach at most 5 files to a message';
  end if;
  if v_body is null and jsonb_array_length(v_files) = 0 then
    raise exception 'Write a message or attach a file';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A message can have at most 4000 characters';
  end if;
  if (select count(*) from public.community_messages m where m.author_id = v_uid and m.created_at > now() - interval '10 seconds') >= 5
     or (select count(*) from public.community_messages m where m.author_id = v_uid and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too quickly. Wait a moment and try again';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from public.community_messages m where m.id = p_reply_to and m.channel_id = p_channel and m.deleted_at is null) then
    raise exception 'The message you are replying to is no longer available';
  end if;

  -- Each file must be the caller's own upload, inside this channel's folder, and not attached before.
  -- Size and type are read from storage, not from the browser.
  for v_file in select * from jsonb_array_elements(v_files) loop
    select o.metadata into v_meta from storage.objects o
    where o.bucket_id = 'community-files' and o.name = v_file ->> 'path' and o.owner_id = v_uid::text
      and o.name like v_channel.community || '/' || p_channel::text || '/%';
    if not found or exists (select 1 from public.community_attachments a where a.storage_path = v_file ->> 'path') then
      raise exception 'An attached file could not be found. Upload it again';
    end if;
    v_summary := v_summary || jsonb_build_object(
      'path', v_file ->> 'path',
      'name', left(regexp_replace(coalesce(nullif(btrim(v_file ->> 'name'), ''), 'file'), '[^[:alnum:] ._()-]', '_', 'g'), 200),
      'mime', coalesce(v_meta ->> 'mimetype', 'application/octet-stream'),
      'size', coalesce((v_meta ->> 'size')::bigint, 0));
  end loop;

  insert into public.community_messages (id, community, channel_id, author_id, author_name, body, reply_to, attachments)
  values (v_id, v_channel.community, p_channel, v_uid, private.chat_name(v_channel.community), v_body, p_reply_to, v_summary);
  insert into public.community_attachments (message_id, channel_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select v_id, p_channel, f ->> 'path', f ->> 'name', f ->> 'mime', greatest((f ->> 'size')::bigint, 1), v_uid
  from jsonb_array_elements(v_summary) f;
  insert into public.community_channel_state (channel_id, user_id, last_read_at) values (p_channel, v_uid, now())
  on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;

  -- Announcements reach members through the notification list of their own portal, unless they opted out.
  if v_channel.kind = 'announcement' then
    if v_channel.community = 'cgs' then
      insert into public.notifications (user_id, type, title, body, link, entity_id)
      select m.user_id, 'community_announcement', 'Announcement: ' || v_channel.name, left(coalesce(v_body, 'A file was shared.'), 200), '/community?channel=' || v_channel.slug, v_id
      from public.community_members m
      left join public.community_channel_state s on s.channel_id = p_channel and s.user_id = m.user_id
      where m.community = 'cgs' and m.status = 'active' and m.user_id <> v_uid and coalesce(s.notify, 'all') <> 'none';
    else
      insert into public.ferd_notifications (user_id, title, body, link)
      select m.user_id, 'Announcement: ' || v_channel.name, left(coalesce(v_body, 'A file was shared.'), 200), '/ferd/community?channel=' || v_channel.slug
      from public.community_members m
      left join public.community_channel_state s on s.channel_id = p_channel and s.user_id = m.user_id
      where m.community = 'ferd' and m.status = 'active' and m.user_id <> v_uid and coalesce(s.notify, 'all') <> 'none';
    end if;
  end if;
  return v_id;
end $$;

create function public.community_edit(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := nullif(btrim(regexp_replace(coalesce(p_body, ''), E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', 'g')), '');
  v_message public.community_messages;
begin
  select * into v_message from public.community_messages where id = p_message;
  if not found or v_message.author_id is distinct from (select auth.uid()) or v_message.deleted_at is not null
     or not private.chat_can_post(v_message.channel_id) then
    raise exception 'You cannot edit this message';
  end if;
  if v_body is null and jsonb_array_length(v_message.attachments) = 0 then
    raise exception 'A message cannot be empty';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A message can have at most 4000 characters';
  end if;
  update public.community_messages set body = v_body, edited_at = now() where id = p_message;
end $$;

-- The author removes their own message; a moderator removes anyone's, and that is recorded with the text.
create function public.community_delete(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_message public.community_messages;
  v_own boolean;
begin
  select * into v_message from public.community_messages where id = p_message;
  if not found or v_message.deleted_at is not null or not private.chat_can_read(v_message.channel_id) then
    raise exception 'Message not found';
  end if;
  v_own := v_message.author_id = v_uid;
  if not coalesce(v_own, false) and not private.chat_can_moderate(v_message.community) then
    raise exception 'You cannot delete this message';
  end if;
  update public.community_messages
  set body = null, attachments = '[]'::jsonb, reactions = '{}'::jsonb, is_pinned = false, deleted_at = now(), deleted_by = v_uid
  where id = p_message;
  -- Without their attachment rows the files can no longer be opened by anyone but the uploader.
  delete from public.community_attachments where message_id = p_message;
  delete from public.community_reactions where message_id = p_message;
  if not coalesce(v_own, false) then
    perform private.chat_audit(v_message.community, 'message.removed', v_message.channel_id, p_message, v_message.author_id,
      jsonb_build_object('text', v_message.body, 'files', jsonb_array_length(v_message.attachments)));
  end if;
end $$;

create function public.community_react(p_message uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_message public.community_messages;
begin
  select * into v_message from public.community_messages where id = p_message;
  if not found or v_message.deleted_at is not null or not private.chat_can_read(v_message.channel_id)
     or private.chat_role(v_message.community) is null then
    raise exception 'Message not found';
  end if;
  delete from public.community_reactions where message_id = p_message and user_id = v_uid and emoji = p_emoji;
  if not found then
    insert into public.community_reactions (message_id, user_id, emoji) values (p_message, v_uid, p_emoji);
  end if;
  update public.community_messages
  set reactions = coalesce((select jsonb_object_agg(r.emoji, r.users) from (
        select emoji, jsonb_agg(user_id order by created_at) as users from public.community_reactions where message_id = p_message group by emoji) r), '{}'::jsonb)
  where id = p_message;
end $$;

create function public.community_pin(p_message uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_message public.community_messages;
begin
  select * into v_message from public.community_messages where id = p_message;
  if not found or v_message.deleted_at is not null or not private.chat_can_read(v_message.channel_id)
     or not private.chat_can_moderate(v_message.community) then
    raise exception 'Only moderators pin messages';
  end if;
  update public.community_messages set is_pinned = p_pinned, pinned_by = case when p_pinned then (select auth.uid()) end where id = p_message;
  perform private.chat_audit(v_message.community, case when p_pinned then 'message.pinned' else 'message.unpinned' end, v_message.channel_id, p_message, v_message.author_id);
end $$;

create function public.community_report(p_message uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_message public.community_messages;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_message from public.community_messages where id = p_message;
  if not found or v_message.deleted_at is not null or not private.chat_can_read(v_message.channel_id) then
    raise exception 'Message not found';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'Say in a few words what is wrong with this message';
  end if;
  insert into public.community_reports (community, message_id, reporter_id, reason)
  values (v_message.community, p_message, (select auth.uid()), v_reason)
  on conflict (message_id, reporter_id) do nothing;
end $$;

create function public.community_resolve_report(p_report uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_report public.community_reports;
begin
  select * into v_report from public.community_reports where id = p_report;
  if not found or not private.chat_can_moderate(v_report.community) then
    raise exception 'Only moderators handle reports';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Unknown decision';
  end if;
  update public.community_reports
  set status = p_status, resolved_by = (select auth.uid()), resolved_at = now(), resolution = nullif(left(btrim(coalesce(p_note, '')), 500), '')
  where id = p_report;
  perform private.chat_audit(v_report.community, 'report.' || p_status, null, v_report.message_id, v_report.reporter_id, jsonb_build_object('report', p_report));
end $$;

-- Text search across the channels the caller may read.
create function public.community_search(p_community text, p_query text) returns setof public.community_messages
language sql stable security definer set search_path = '' as $$
  select m.* from public.community_messages m
  where m.community = p_community and m.deleted_at is null and char_length(btrim(coalesce(p_query, ''))) >= 2
    and m.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and private.chat_can_read(m.channel_id)
  order by m.created_at desc
  limit 30
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: read-only policies. There are no write policies; the functions above are the only way in.
-- ---------------------------------------------------------------------------
alter table public.community_settings enable row level security;
alter table public.community_members enable row level security;
alter table public.community_channels enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_attachments enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_channel_state enable row level security;
alter table public.community_audit enable row level security;

create policy community_settings_select on public.community_settings for select to authenticated
  using (private.chat_eligible(community));
create policy community_members_select on public.community_members for select to authenticated
  using (user_id = (select auth.uid()) or (status = 'active' and private.chat_role(community) is not null) or private.chat_can_moderate(community));
create policy community_channels_select on public.community_channels for select to authenticated
  using (private.chat_channel_visible(community, kind, project_id, department_id) and (archived_at is null or private.chat_can_moderate(community)));
create policy community_messages_select on public.community_messages for select to authenticated
  using (private.chat_can_read(channel_id));
create policy community_reactions_select on public.community_reactions for select to authenticated
  using (exists (select 1 from public.community_messages m where m.id = message_id));
create policy community_attachments_select on public.community_attachments for select to authenticated
  using (private.chat_can_read(channel_id));
create policy community_reports_select on public.community_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.chat_can_moderate(community));
create policy community_channel_state_select on public.community_channel_state for select to authenticated
  using (user_id = (select auth.uid()));
create policy community_audit_select on public.community_audit for select to authenticated
  using (private.chat_can_moderate(community));

revoke all on
  public.community_settings, public.community_members, public.community_channels, public.community_messages, public.community_reactions,
  public.community_attachments, public.community_reports, public.community_channel_state, public.community_audit
from anon, authenticated;
grant select on
  public.community_settings, public.community_members, public.community_channels, public.community_messages, public.community_reactions,
  public.community_attachments, public.community_reports, public.community_channel_state, public.community_audit
to authenticated;

-- Functions: closed to visitors, open to signed-in users (each one checks the caller itself).
revoke execute on function
  private.chat_eligible(text), private.chat_is_admin(text), private.chat_user_is_admin(text, uuid), private.chat_role(text),
  private.chat_can_moderate(text), private.chat_channel_visible(text, text, uuid, uuid), private.chat_can_read(uuid),
  private.chat_can_post(uuid), private.chat_name(text), private.chat_path_channel(text), private.chat_topic_channel(text),
  private.chat_audit(text, text, uuid, uuid, uuid, jsonb)
from public, anon;
grant execute on function
  private.chat_eligible(text), private.chat_role(text), private.chat_can_moderate(text),
  private.chat_channel_visible(text, text, uuid, uuid), private.chat_can_read(uuid), private.chat_can_post(uuid),
  private.chat_path_channel(text), private.chat_topic_channel(text)
to authenticated;
revoke execute on function private.chat_is_admin(text), private.chat_user_is_admin(text, uuid), private.chat_name(text), private.chat_audit(text, text, uuid, uuid, uuid, jsonb) from authenticated;

revoke execute on function
  public.community_join(text), public.community_member_list(text), public.community_moderate_member(text, uuid, text, integer),
  public.community_set_approval(text, boolean), public.community_set_presence(text, boolean), public.community_channel_list(text),
  public.community_save_channel(text, uuid, text, text, text, boolean), public.community_open_project(uuid), public.community_my_projects(),
  public.community_mark_read(uuid), public.community_set_notify(uuid, text), public.community_send(uuid, text, uuid, jsonb),
  public.community_edit(uuid, text), public.community_delete(uuid), public.community_react(uuid, text), public.community_pin(uuid, boolean),
  public.community_report(uuid, text), public.community_resolve_report(uuid, text, text), public.community_search(text, text)
from public, anon;
grant execute on function
  public.community_join(text), public.community_member_list(text), public.community_moderate_member(text, uuid, text, integer),
  public.community_set_approval(text, boolean), public.community_set_presence(text, boolean), public.community_channel_list(text),
  public.community_save_channel(text, uuid, text, text, text, boolean), public.community_open_project(uuid), public.community_my_projects(),
  public.community_mark_read(uuid), public.community_set_notify(uuid, text), public.community_send(uuid, text, uuid, jsonb),
  public.community_edit(uuid, text), public.community_delete(uuid), public.community_react(uuid, text), public.community_pin(uuid, boolean),
  public.community_report(uuid, text), public.community_resolve_report(uuid, text, text), public.community_search(text, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage for attachments: <community>/<channel id>/<generated name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-files', 'community-files', false, 10485760,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

create policy community_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-files' and private.chat_can_post(private.chat_path_channel(name)));
-- A file is readable by the channel's readers once it is attached to a message, and by its uploader before that.
create policy community_files_select on storage.objects for select to authenticated
  using (bucket_id = 'community-files' and private.chat_can_read(private.chat_path_channel(name))
    and (owner_id = (select auth.uid())::text or exists (select 1 from public.community_attachments a where a.storage_path = name)));
create policy community_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-files' and private.chat_can_read(private.chat_path_channel(name))
    and (owner_id = (select auth.uid())::text or private.chat_can_moderate(split_part(name, '/', 1))));

-- ---------------------------------------------------------------------------
-- Real-time
-- ---------------------------------------------------------------------------
-- New and changed messages are delivered through Postgres Changes, which applies the SELECT policy above
-- to every subscriber. Typing and presence use private topics 'chat:<channel id>', authorised here.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.community_messages;
  end if;
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy community_realtime_select on realtime.messages for select to authenticated
        using (private.chat_can_read(private.chat_topic_channel(realtime.topic())))
    $policy$;
    execute $policy$
      create policy community_realtime_insert on realtime.messages for insert to authenticated
        with check (private.chat_can_read(private.chat_topic_channel(realtime.topic())))
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Starting channels
-- ---------------------------------------------------------------------------
insert into public.community_channels (community, kind, slug, name, description, sort_order) values
  ('cgs', 'announcement', 'announcements', 'Announcements', 'Official announcements from Cypher Green Systems.', 10),
  ('cgs', 'public', 'general', 'General', 'Introductions and general discussion among members.', 20),
  ('cgs', 'public', 'environmental-science', 'Environmental science', 'Ecology, conservation, climate and environmental research.', 30),
  ('cgs', 'public', 'gis', 'GIS and remote sensing', 'Mapping, spatial analysis and satellite data.', 40),
  ('cgs', 'public', 'carbon-projects', 'Carbon projects', 'Project design, monitoring, reporting and verification.', 50),
  ('cgs', 'public', 'waste-management', 'Waste management', 'Collection, recycling and the circular economy.', 60),
  ('cgs', 'public', 'sustainability', 'Sustainability', 'Sustainable practice in organisations and communities.', 70),
  ('cgs', 'public', 'technology', 'Technology', 'Software, sensors and data for environmental work.', 80),
  ('cgs', 'public', 'technical-support', 'Technical support', 'Help with using the portal.', 90),
  ('cgs', 'public', 'product-feedback', 'Product feedback', 'Suggestions and problems to report to the CGS team.', 95),
  ('ferd', 'announcement', 'announcements', 'Announcements', 'Announcements from the departments and FERD staff.', 10),
  ('ferd', 'public', 'general', 'General', 'Student discussion and peer support.', 20),
  ('ferd', 'public', 'course-units', 'Course units', 'Questions and study help on course units.', 30),
  ('ferd', 'public', 'practicals', 'Practicals', 'Laboratory and field practicals.', 40),
  ('ferd', 'public', 'gis', 'GIS', 'GIS software, mapping exercises and spatial data.', 50),
  ('ferd', 'public', 'research', 'Research', 'Research projects, proposals and methods.', 60),
  ('ferd', 'public', 'careers-internships', 'Careers and internships', 'Attachments, internships, jobs and career advice.', 70),
  ('ferd', 'public', 'events-trips', 'Events and trips', 'Department events, field trips and academic opportunities.', 80);

insert into public.community_channels (community, kind, slug, name, description, department_id, sort_order)
select 'ferd', 'department', 'dept-' || lower(d.code), d.name, 'For students of this department and FERD staff.', d.id, 200
from public.ferd_departments d;
