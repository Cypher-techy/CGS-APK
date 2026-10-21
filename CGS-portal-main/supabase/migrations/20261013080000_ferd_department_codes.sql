-- Department abbreviations as the university writes them: ENSC, NARE, GEOG (were ES, NR, GEO).
-- Only the displayed code changes; departments are referenced everywhere by id.
update public.ferd_departments set code = 'ENSC' where slug = 'environmental-science';
update public.ferd_departments set code = 'NARE' where slug = 'natural-resources';
update public.ferd_departments set code = 'GEOG' where slug = 'geography';
