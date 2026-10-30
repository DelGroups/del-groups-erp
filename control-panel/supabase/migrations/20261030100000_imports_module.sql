-- Imports module (IMP-1) in the control plane's module catalog, so plans and the provisioning
-- form can offer it. It depends on core and purchases. Safe to re-run.

insert into public.modules (id, name, depends, is_core) values
  ('imports', 'Imports', '{core,purchases}', false)
on conflict (id) do nothing;
