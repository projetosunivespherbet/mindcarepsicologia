-- Fase 1: hardening. Revise antes de aplicar em produção.

-- 1) Contatos dos psicólogos não devem ser visíveis a qualquer usuário autenticado.
DROP POLICY IF EXISTS "Patients can view psychologist profiles" ON public.profiles;

-- 2) O papel (role) só pode ser definido uma vez; depois disso não pode ser trocado
--    pelo próprio usuário. A definição inicial (NULL -> valor) continua funcionando.
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'O papel do usuário não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_role_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_role_change ON public.profiles;
CREATE TRIGGER trg_prevent_role_change
BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- 3) Validação de horário: comparar com o horário de São Paulo, não com UTC.
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
  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'Horário inválido: início deve ser antes do fim';
  END IF;

  IF NEW.status = 'indisponivel' THEN
    RETURN NEW;
  END IF;

  IF (NEW.appointment_date + NEW.start_time)
       < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute') THEN
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
REVOKE EXECUTE ON FUNCTION public.validate_appointment() FROM PUBLIC, anon, authenticated;

-- Garante o trigger caso o banco não o tenha (o histórico antigo não o criava).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.appointments'::regclass
      AND p.proname = 'validate_appointment'
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER trg_validate_appointment
    BEFORE INSERT OR UPDATE OF appointment_date, start_time, end_time, psychologist_id
    ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.validate_appointment();
  END IF;
END
$$;

-- 4) Função do diretório de perfis e de nome de exibição: sem uso no produto atual.
DROP FUNCTION IF EXISTS public.get_user_display_name(uuid);
