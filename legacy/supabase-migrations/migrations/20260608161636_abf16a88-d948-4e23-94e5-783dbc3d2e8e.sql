
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'individual';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_tipo_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_tipo_check CHECK (tipo IN ('individual','grupo'));

CREATE OR REPLACE FUNCTION public.prevent_appointment_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS trg_prevent_appointment_conflict ON public.appointments;
CREATE TRIGGER trg_prevent_appointment_conflict
BEFORE INSERT OR UPDATE OF appointment_date, start_time, end_time, psychologist_id, tipo, status
ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.prevent_appointment_conflict();
