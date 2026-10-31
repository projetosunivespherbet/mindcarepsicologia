
-- 1) psychologist_profiles: drop broad SELECT policy that exposed CRP
DROP POLICY IF EXISTS "Authenticated users can view psychologist profiles" ON public.psychologist_profiles;

-- Secure directory function that EXCLUDES crp
CREATE OR REPLACE FUNCTION public.get_psychologist_directory()
RETURNS TABLE (
  user_id uuid,
  trajetoria_profissional text,
  especializacoes text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pp.user_id, pp.trajetoria_profissional, pp.especializacoes
  FROM public.psychologist_profiles pp
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_psychologist_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_psychologist_directory() TO authenticated;

-- Allow a patient to fetch the CRP of a psychologist they are linked to (confirmed/connected)
CREATE OR REPLACE FUNCTION public.get_psychologist_crp(p_psych_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_crp text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF auth.uid() = p_psych_id
     OR EXISTS (SELECT 1 FROM public.psychologist_patients
                WHERE psychologist_id = p_psych_id AND patient_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.appointments
                WHERE psychologist_id = p_psych_id AND patient_id = auth.uid())
  THEN
    SELECT crp INTO v_crp FROM public.psychologist_profiles WHERE user_id = p_psych_id;
    RETURN v_crp;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.get_psychologist_crp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_psychologist_crp(uuid) TO authenticated;

-- 2) appointments INSERT: prevent patients from setting financial fields
DROP POLICY IF EXISTS "Patients can create appointments" ON public.appointments;
CREATE POLICY "Patients can create appointments"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = patient_id
  AND valor IS NULL
  AND payment_status = 'pendente'
  AND convenio = false
  AND convenio_file_url IS NULL
  AND imposto = false
  AND imposto_file_url IS NULL
  AND status IN ('agendado','pendente')
  AND tipo = 'individual'
);

-- 3) storage: allow patients to read appointment docs that belong to their own appointments
DROP POLICY IF EXISTS "Patients can view own appointment docs" ON storage.objects;
CREATE POLICY "Patients can view own appointment docs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'appointment-docs'
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id::text = (storage.foldername(name))[2]
      AND a.patient_id = auth.uid()
  )
);
