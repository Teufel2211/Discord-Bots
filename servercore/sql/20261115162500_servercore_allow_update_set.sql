CREATE OR REPLACE FUNCTION public.sc_exec_sql(
  p_sql text,
  p_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_sql text := p_sql;
  v_parameter record;
  v_replacement text;
  v_row record;
  v_rows jsonb := '[]'::jsonb;
  v_row_count bigint := 0;
BEGIN
  IF p_sql IS NULL OR length(p_sql) > 30000 THEN
    RAISE EXCEPTION 'Invalid or oversized SQL statement.';
  END IF;
  IF jsonb_typeof(COALESCE(p_params, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'SQL parameters must be a JSON array.';
  END IF;
  IF upper(ltrim(p_sql)) !~ '^(SELECT|INSERT|UPDATE|DELETE|WITH)([[:space:]]|$)' THEN
    RAISE EXCEPTION 'Only SELECT/INSERT/UPDATE/DELETE statements are allowed.';
  END IF;
  IF p_sql !~ '"SC_[A-Za-z0-9_]+"' THEN
    RAISE EXCEPTION 'SQL may only target ServerCore tables.';
  END IF;
  IF position(';' in p_sql) > 0 OR position('--' in p_sql) > 0
     OR position('/*' in p_sql) > 0 OR position('*/' in p_sql) > 0
     OR position('pg_catalog.' in lower(p_sql)) > 0
     OR position('information_schema.' in lower(p_sql)) > 0
     OR position('auth.' in lower(p_sql)) > 0
     OR position('storage.' in lower(p_sql)) > 0
     OR position('vault.' in lower(p_sql)) > 0 THEN
    RAISE EXCEPTION 'The SQL statement contains a forbidden construct.';
  END IF;
  IF upper(p_sql) ~ '(^|[[:space:]])(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|RESET|VACUUM|ANALYZE|EXPLAIN)([[:space:]]|$)' THEN
    RAISE EXCEPTION 'DDL and administrative SQL are not allowed through this endpoint.';
  END IF;

  FOR v_parameter IN
    SELECT value, ordinality
    FROM jsonb_array_elements(COALESCE(p_params, '[]'::jsonb)) WITH ORDINALITY
    ORDER BY ordinality DESC
  LOOP
    CASE jsonb_typeof(v_parameter.value)
      WHEN 'null' THEN
        v_replacement := 'NULL';
      WHEN 'string' THEN
        v_replacement := quote_nullable(v_parameter.value #>> '{}');
      WHEN 'number' THEN
        v_replacement := v_parameter.value::text;
      WHEN 'boolean' THEN
        v_replacement := v_parameter.value::text;
      WHEN 'array' THEN
        SELECT 'ARRAY[' || COALESCE(string_agg(quote_nullable(item #>> '{}'), ','), '') || ']'
          INTO v_replacement
        FROM jsonb_array_elements(v_parameter.value) AS element(item);
      WHEN 'object' THEN
        v_replacement := quote_nullable(v_parameter.value::text);
      ELSE
        RAISE EXCEPTION 'Unsupported SQL parameter type.';
    END CASE;

    v_sql := replace(v_sql, '$' || v_parameter.ordinality::text, v_replacement);
  END LOOP;

  IF upper(ltrim(v_sql)) ~ '^SELECT([[:space:]]|$)' OR position('RETURNING' in upper(v_sql)) > 0 THEN
    FOR v_row IN EXECUTE v_sql LOOP
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
      IF jsonb_array_length(v_rows) > 5000 THEN
        RAISE EXCEPTION 'Query returned too many rows; add a LIMIT clause.';
      END IF;
    END LOOP;
    v_row_count := jsonb_array_length(v_rows);
  ELSE
    EXECUTE v_sql;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('rows', v_rows, 'rowCount', v_row_count);
END;
$function$;
