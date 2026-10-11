-- public.is_admin() still read profiles.role, a column that no longer exists
-- (profiles now has role_id). Every RLS policy that calls it failed with
-- `column "role" does not exist` as soon as a row was checked, e.g. saving a
-- new CRM deal (deals, quotations) and the HR tables employee_advances,
-- employee_leaves and payrolls.
--
-- Point it at the current admin check (user_is_admin(), roles.name = 'admin')
-- so all those policies work again without touching the policies themselves.

create or replace function public.is_admin()
  returns boolean
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select public.user_is_admin();
$function$;
