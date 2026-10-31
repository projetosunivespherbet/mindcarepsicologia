-- Limite de tentativas por IP (a Cloudflare não oferece regras de rate limiting em *.workers.dev).
CREATE TABLE rate_limit_hits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits int NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY; -- sem policies nem privilégios: só a função abaixo mexe

-- Janela fixa. Devolve true se a requisição está dentro do limite.
CREATE FUNCTION app_rate_limit(p_bucket text, p_limit int, p_window_seconds int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w timestamptz;
  n int;
BEGIN
  w := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO rate_limit_hits (bucket, window_start, hits) VALUES (p_bucket, w, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limit_hits.hits + 1
  RETURNING hits INTO n;
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_hits WHERE window_start < now() - interval '1 day';
  END IF;
  RETURN n <= p_limit;
END $$;

REVOKE ALL ON FUNCTION app_rate_limit(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_rate_limit(text, int, int) TO app_runtime;
