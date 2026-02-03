-- Ejecutar en Supabase SQL Editor para que el endpoint POST /api/size funcione.
-- La tabla public.size_guide_values debe existir con columnas:
--   size_guide_id (int), measurement (text, ej. 'pecho'|'cintura'|'cadera'),
--   size_label (text), min_value (numeric), max_value (numeric).

create or replace function public.get_size_recommendation(
  p_guide_id int,
  p_pecho numeric,
  p_cintura numeric,
  p_cadera numeric
)
returns table (
  talla text,
  basado_en text,
  valor_usado numeric,
  min_value numeric,
  max_value numeric
)
language sql
stable
security definer
as $$
  with input as (
    select
      p_guide_id as size_guide_id,
      greatest(p_pecho, p_cintura, p_cadera) as max_measure,
      case
        when p_pecho   >= p_cintura and p_pecho   >= p_cadera then 'pecho'
        when p_cintura >= p_pecho   and p_cintura >= p_cadera then 'cintura'
        else 'cadera'
      end as max_measurement
  )
  select
    sgv.size_label as talla,
    i.max_measurement as basado_en,
    i.max_measure as valor_usado,
    sgv.min_value,
    sgv.max_value
  from public.size_guide_values sgv
  join input i
    on sgv.size_guide_id = i.size_guide_id
   and sgv.measurement = i.max_measurement
  where i.max_measure between sgv.min_value and sgv.max_value
  order by sgv.min_value
  limit 1;
$$;

-- Opcional: permitir invocación anónima si usas anon key
-- alter function public.get_size_recommendation(int, numeric, numeric, numeric) set search_path = public;
