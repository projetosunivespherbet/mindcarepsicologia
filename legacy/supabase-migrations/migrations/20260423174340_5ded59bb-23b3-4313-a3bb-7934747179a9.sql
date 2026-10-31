DROP POLICY IF EXISTS "Psychologists can add patients" ON public.psychologist_patients;

CREATE POLICY "Patients can confirm psychologist"
ON public.psychologist_patients
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = patient_id);

CREATE POLICY "Psychologists can add patients"
ON public.psychologist_patients
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = psychologist_id);

DROP POLICY IF EXISTS "Psychologists can remove patients" ON public.psychologist_patients;

CREATE POLICY "Psychologist or patient can remove link"
ON public.psychologist_patients
FOR DELETE
TO authenticated
USING (auth.uid() = psychologist_id OR auth.uid() = patient_id);