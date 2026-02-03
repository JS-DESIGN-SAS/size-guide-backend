"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseClient = getSupabaseClient;
exports.queryTable = queryTable;
exports.getSizeRecommendation = getSizeRecommendation;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("./config");
let client = null;
/**
 * Devuelve el cliente de Supabase (singleton). null si URL o key no están configurados.
 */
function getSupabaseClient() {
    if (!config_1.config.supabaseUrl || !config_1.config.supabaseAnonKey) {
        return null;
    }
    if (!client) {
        client = (0, supabase_js_1.createClient)(config_1.config.supabaseUrl, config_1.config.supabaseAnonKey);
    }
    return client;
}
/** Límite por defecto de filas en select para el endpoint público */
const DEFAULT_SELECT_LIMIT = 100;
/**
 * Consulta una tabla con .from(table).select().
 * tableName por defecto: config.supabaseDefaultTable.
 */
async function queryTable(tableName) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return {
            data: null,
            error: { message: "Supabase not configured (missing SUPABASE_URL or key)" },
        };
    }
    const table = tableName?.trim() || config_1.config.supabaseDefaultTable;
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
/**
 * Ejecuta la RPC get_size_recommendation en Supabase.
 * La función debe existir en la BD (ver supabase/get_size_recommendation.sql).
 */
async function getSizeRecommendation(params) {
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
    return { data: row, error: null };
}
