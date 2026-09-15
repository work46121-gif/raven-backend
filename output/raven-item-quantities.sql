-- Enable optional per-person quantities. Existing equal splits are unchanged.
begin;
alter table public.receipt_items add column if not exists quantity_split jsonb;
commit;
