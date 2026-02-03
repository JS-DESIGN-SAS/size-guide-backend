import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

let client: SupabaseClient | null = null;

/**
 * Devuelve el cliente de Supabase (singleton). null si URL o key no están configurados.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return client;
}

/** Límite por defecto de filas en select para el endpoint público */
const DEFAULT_SELECT_LIMIT = 100;

export interface QueryTableResult {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

/**
 * Consulta una tabla con .from(table).select().
 * tableName por defecto: config.supabaseDefaultTable.
 */
export async function queryTable(
  tableName?: string
): Promise<QueryTableResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: null,
      error: { message: "Supabase not configured (missing SUPABASE_URL or key)" },
    };
  }
  const table = tableName?.trim() || config.supabaseDefaultTable;
  if (!table) {
    return { data: null, error: { message: "Table name is required" } };
  }
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .limit(DEFAULT_SELECT_LIMIT);
  if (error) {
    return {
      data: null,
      error: { message: error.message, code: error.code },
    };
  }
  return { data: data ?? [], error: null };
}

/** Parámetros para la recomendación de talla (RPC get_size_recommendation) */
export interface SizeRecommendationParams {
  guideId: number;
  pecho: number;
  cintura: number;
  cadera: number;
}

/** Una fila devuelta por get_size_recommendation */
export interface SizeRecommendationRow {
  talla: string;
  basado_en: string;
  valor_usado: number;
  min_value: number;
  max_value: number;
}

export interface SizeRecommendationResult {
  data: SizeRecommendationRow | null;
  error: { message: string; code?: string } | null;
}

/**
 * Ejecuta la RPC get_size_recommendation en Supabase.
 * La función debe existir en la BD (ver supabase/get_size_recommendation.sql).
 */
export async function getSizeRecommendation(
  params: SizeRecommendationParams
): Promise<SizeRecommendationResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: null,
      error: { message: "Supabase not configured (missing SUPABASE_URL or key)" },
    };
  }
  const { data, error } = await supabase.rpc("get_size_recommendation", {
    p_guide_id: params.guideId,
    p_pecho: params.pecho,
    p_cintura: params.cintura,
    p_cadera: params.cadera,
  });
  if (error) {
    return {
      data: null,
      error: { message: error.message, code: error.code },
    };
  }
  // RPC que devuelve tabla: data es array; queremos la primera fila
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return { data: row as SizeRecommendationRow | null, error: null };
}
