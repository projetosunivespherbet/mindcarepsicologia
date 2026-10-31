
-- 1) Psychologist profiles: only authenticated users can browse the directory
DROP POLICY IF EXISTS "Patients can view psychologist profiles" ON public.psychologist_profiles;
CREATE POLICY "Authenticated users can view psychologist profiles"
ON public.psychologist_profiles
FOR SELECT
TO authenticated
USING (true);

-- 2) Restrict patient UPDATE on appointments to status changes only (cancellation)
CREATE OR REPLACE FUNCTION public.restrict_patient_appointment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- only enforce when the caller is the patient (not the psychologist)
  IF auth.uid() = OLD.patient_id AND auth.uid() <> OLD.psychologist_id THEN
    IF NEW.psychologist_id   IS DISTINCT FROM OLD.psychologist_id
    OR NEW.patient_id        IS DISTINCT FROM OLD.patient_id
    OR NEW.appointment_date  IS DISTINCT FROM OLD.appointment_date
    OR NEW.start_time        IS DISTINCT FROM OLD.start_time
    OR NEW.end_time          IS DISTINCT FROM OLD.end_time
    OR NEW.valor             IS DISTINCT FROM OLD.valor
    OR NEW.payment_status    IS DISTINCT FROM OLD.payment_status
    OR NEW.convenio          IS DISTINCT FROM OLD.convenio
    OR NEW.convenio_file_url IS DISTINCT FROM OLD.convenio_file_url
    OR NEW.imposto           IS DISTINCT FROM OLD.imposto
    OR NEW.imposto_file_url  IS DISTINCT FROM OLD.imposto_file_url
    OR NEW.tipo              IS DISTINCT FROM OLD.tipo
    THEN
      RAISE EXCEPTION 'Pacientes só podem alterar o status do agendamento (cancelamento).';
    END IF;

    IF NEW.status NOT IN ('cancelado') THEN
      RAISE EXCEPTION 'Pacientes só podem cancelar agendamentos.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.restrict_patient_appointment_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_restrict_patient_appointment_update ON public.appointments;
CREATE TRIGGER trg_restrict_patient_appointment_update
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.restrict_patient_appointment_update();
