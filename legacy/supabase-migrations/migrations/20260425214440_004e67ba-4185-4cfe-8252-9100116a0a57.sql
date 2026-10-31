ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status = ANY (ARRAY['agendado'::text, 'confirmado'::text, 'cancelado'::text, 'concluido'::text, 'recusado'::text, 'indisponivel'::text]));