-- Baseline para bancos novos: o histórico original usa as funções abaixo (migration de
-- 22/06 faz REVOKE nelas) mas nenhuma migration as criava. Cada bloco só cria a função se
-- ela ainda não existir, então um banco que já as tenha não é alterado.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_user_display_name' AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.get_user_display_name(p_user_id uuid)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $f$
      SELECT nome_completo FROM public.profiles WHERE user_id = p_user_id
    $f$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'validate_appointment' AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.validate_appointment()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $f$
    BEGIN
      RETURN NEW;
    END;
    $f$;
  END IF;
END
$$;
