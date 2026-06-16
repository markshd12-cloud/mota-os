-- Rate limiting para rotas de autenticação
-- Registra tentativas por identificador (IP) e endpoint, com limpeza automática

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id            bigserial    PRIMARY KEY,
  identifier    text         NOT NULL,
  endpoint      text         NOT NULL,
  attempted_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_lookup_idx
  ON auth_rate_limits (identifier, endpoint, attempted_at DESC);

-- Função RPC: registra tentativa e retorna true se permitido, false se bloqueado
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier     text,
  p_endpoint       text,
  p_max_attempts   int,
  p_window_seconds int
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_count int;
BEGIN
  -- Limpa tentativas expiradas antes de contar
  DELETE FROM auth_rate_limits
  WHERE attempted_at < now() - (p_window_seconds || ' seconds')::interval;

  -- Conta tentativas recentes para este identificador + endpoint
  SELECT COUNT(*) INTO attempt_count
  FROM auth_rate_limits
  WHERE identifier = p_identifier
    AND endpoint   = p_endpoint
    AND attempted_at > now() - (p_window_seconds || ' seconds')::interval;

  IF attempt_count >= p_max_attempts THEN
    RETURN false;
  END IF;

  -- Registra esta tentativa
  INSERT INTO auth_rate_limits (identifier, endpoint)
  VALUES (p_identifier, p_endpoint);

  RETURN true;
END;
$$;

-- Apenas service_role pode chamar — nunca exposto a clientes
GRANT EXECUTE ON FUNCTION check_rate_limit TO service_role;
REVOKE EXECUTE ON FUNCTION check_rate_limit FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION check_rate_limit FROM anon;
REVOKE EXECUTE ON FUNCTION check_rate_limit FROM authenticated;
