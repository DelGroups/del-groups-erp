-- Calendar module (phase 20) in the control plane's module catalog, so plans and the
-- provisioning form can offer it. It depends on core only. Safe to re-run.

insert into public.modules (id, name, depends, is_core) values
  ('calendar', 'Calendar', '{core}', false)
on conflict (id) do nothing;
