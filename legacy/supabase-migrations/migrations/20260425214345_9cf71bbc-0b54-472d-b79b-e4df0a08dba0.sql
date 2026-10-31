-- Permitir que pacientes (e qualquer autenticado) vejam horários bloqueados
-- pelo profissional, para que apareçam como "Ocupado" no calendário
CREATE POLICY "Anyone authenticated can view unavailable slots"
ON public.appointments
FOR SELECT
TO authenticated
USING (status = 'indisponivel');