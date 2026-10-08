-- Werkbank Teil 6a, review fixes of the technician app. my_assignment as in
-- 20261008180000_werkbank_visit_report_logic.sql with two changes: "technicians" lists the
-- co-technicians only (the caller is no longer among them), and reports come newest first
-- (spec R4). Signature, grants and every other field are unchanged.

-- One assigned order with contact, line items (no prices), co-technicians and visit reports.
-- Never returns prices, discounts, totals or office_note.
create or replace function werkbank.my_assignment(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_artist public.artists := werkbank.assigned_artist(p_order);
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  return (
    select jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id, 'org_id', o.org_id, 'order_no', o.order_no, 'status', o.status,
        'scheduled_date', o.scheduled_date, 'scheduled_time', o.scheduled_time, 'subject', o.subject,
        'customer_name', coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
        'street', coalesce(p.street, c.street), 'postal_code', coalesce(p.postal_code, c.postal_code),
        'city', coalesce(p.city, c.city),
        'group_key', werkbank.assignment_group(o.status, o.scheduled_date, o.completed_at, v_today),
        'location_note', o.location_note, 'notes', o.notes),
      'contact', (
        select jsonb_build_object('name', concat_ws(' ', nullif(btrim(k.first_name), ''), k.last_name),
          'phone', k.phone, 'mobile', k.mobile, 'email', k.email)
        from werkbank.contacts k where k.org_id = o.org_id and k.id = o.contact_id),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('position', i.sort_order, 'title', i.name, 'description', i.description,
          'quantity', i.quantity, 'unit', i.unit_code, 'kind', i.kind) order by i.sort_order, i.id)
        from werkbank.document_items i where i.order_id = o.id), '[]'::jsonb),
      'technicians', coalesce((
        select jsonb_agg(a.name order by a.name, a.id)
        from werkbank.order_technicians ot join public.artists a on a.id = ot.artist_id
        where ot.order_id = o.id and ot.artist_id <> v_artist.id), '[]'::jsonb),
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'artist_id', r.artist_id, 'technician_name', r.technician_name, 'visit_date', r.visit_date,
          'body', r.body, 'locked_at', r.locked_at, 'signer_name', r.signer_name,
          'signature_path', r.signature_path, 'signed_at', r.signed_at,
          'is_mine', r.artist_id is not distinct from v_artist.id,
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.path, 'position', ph.position, 'caption', ph.caption)
              order by ph.position, ph.id)
            from werkbank.visit_report_photos ph where ph.report_id = r.id), '[]'::jsonb))
          order by r.visit_date desc, r.created_at desc, r.id desc)
        from werkbank.visit_reports r where r.org_id = o.org_id and r.order_id = o.id), '[]'::jsonb))
    from werkbank.orders o
    join werkbank.customers c on c.org_id = o.org_id and c.id = o.customer_id
    left join werkbank.properties p on p.org_id = o.org_id and p.id = o.property_id
    where o.id = p_order);
end;
$$;
revoke all on function werkbank.my_assignment(uuid) from public, anon;
grant execute on function werkbank.my_assignment(uuid) to authenticated;
