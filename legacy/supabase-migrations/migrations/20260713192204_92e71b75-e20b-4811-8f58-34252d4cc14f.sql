
-- 1. Restrict availability_slots reads to the owning psychologist.
DROP POLICY IF EXISTS "Patients can view available slots" ON public.availability_slots;

-- 2. Make the appointment validator SECURITY DEFINER so the trigger can still
--    read availability_slots when a patient inserts an appointment.
CREATE OR REPLACE FUNCTION public.validate_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dow INTEGER;
  v_has_slot BOOLEAN;
BEGIN
  IF NEW.status = 'indisponivel' THEN
    IF NEW.start_time >= NEW.end_time THEN
      RAISE EXCEPTION 'Horário inválido: início deve ser antes do fim';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'Horário inválido: início deve ser antes do fim';
  END IF;

  IF (NEW.appointment_date + NEW.start_time) < (now() - interval '1 minute') THEN
    RAISE EXCEPTION 'Não é possível agendar em horário passado';
  END IF;

  v_dow := EXTRACT(DOW FROM NEW.appointment_date)::INTEGER;

  SELECT EXISTS (
    SELECT 1 FROM public.availability_slots a
    WHERE a.psychologist_id = NEW.psychologist_id
      AND a.day_of_week = v_dow
      AND a.is_available = true
      AND a.start_time <= NEW.start_time
      AND a.end_time >= NEW.end_time
  ) INTO v_has_slot;

  IF NOT v_has_slot AND EXISTS (
       SELECT 1 FROM public.availability_slots a
       WHERE a.psychologist_id = NEW.psychologist_id
         AND a.is_available = true
     ) THEN
    RAISE EXCEPTION 'Profissional não atende neste horário';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Remove the patient self-link INSERT policy on psychologist_patients.
DROP POLICY IF EXISTS "Patients can confirm psychologist" ON public.psychologist_patients;

-- 4. Auto-create the psychologist-patient link when an appointment is inserted.
CREATE OR REPLACE FUNCTION public.link_patient_on_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.psychologist_id IS NULL OR NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.psychologist_id = NEW.patient_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.psychologist_patients (psychologist_id, patient_id)
  VALUES (NEW.psychologist_id, NEW.patient_id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS link_patient_on_appointment_trigger ON public.appointments;
CREATE TRIGGER link_patient_on_appointment_trigger
AFTER INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.link_patient_on_appointment();

-- 5. Ensure a unique link per (psychologist, patient) so ON CONFLICT works
--    and forged duplicates cannot be inserted.
CREATE UNIQUE INDEX IF NOT EXISTS psychologist_patients_pair_unique
  ON public.psychologist_patients (psychologist_id, patient_id);
