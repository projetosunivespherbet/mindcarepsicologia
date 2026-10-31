CREATE POLICY "Patients can view psychologist profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (role = 'psicologo');