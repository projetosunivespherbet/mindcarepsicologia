
CREATE OR REPLACE FUNCTION public.prevent_appointment_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('cancelado','recusado') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.psychologist_id = NEW.psychologist_id
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.appointment_date = NEW.appointment_date
      AND a.status NOT IN ('cancelado','recusado')
      AND a.start_time < NEW.end_time
      AND a.end_time   > NEW.start_time
      AND NOT (a.tipo = 'grupo' AND NEW.tipo = 'grupo')
  ) THEN
    RAISE EXCEPTION 'Conflito de agenda: o profissional já possui um atendimento neste horário'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_appointment_conflict() FROM PUBLIC, anon, authenticated;
