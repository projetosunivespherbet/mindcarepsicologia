
-- 1) Remove leaky policy that exposed appointment rows to all authenticated users
DROP POLICY IF EXISTS "Anyone authenticated can view unavailable slots" ON public.appointments;

-- 2) Expose only date/time availability via a SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.get_psychologist_busy_slots(p_psych_id uuid)
RETURNS TABLE (appointment_date date, start_time time, end_time time, is_unavailable boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.appointment_date, a.start_time, a.end_time,
         (a.status = 'indisponivel') AS is_unavailable
  FROM public.appointments a
  WHERE a.psychologist_id = p_psych_id
    AND a.status IN ('agendado','confirmado','indisponivel')
    AND a.appointment_date >= (now()::date - interval '1 day');
$$;

REVOKE ALL ON FUNCTION public.get_psychologist_busy_slots(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_psychologist_busy_slots(uuid) TO authenticated;

-- 3) Lock down other SECURITY DEFINER functions: no PUBLIC / anon execute
REVOKE ALL ON FUNCTION public.get_user_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_display_name(uuid) TO authenticated;

-- handle_new_user is a trigger; remove any direct execute exposure
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Other helper functions in public should not be directly callable
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_appointment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_appointment_conflict() FROM PUBLIC, anon, authenticated;

-- 4) Realtime publication: remove tables not used for live subscriptions in the frontend.
--    Frontend has no channel().on('postgres_changes') for these — re-add later if needed,
--    using private channels filtered by patient_id/conversation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments', 'messages'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
