"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_IMAGE_NOT_FOUND = void 0;
exports.getProductImageData = getProductImageData;
exports.getProductImageUrl = getProductImageUrl;
const bigquery_1 = require("@google-cloud/bigquery");
const config_1 = require("./config");
const logger_1 = require("../shared/logger");
// SQL exacto: prefijo de proyecto inyectado para qualified names (project.dataset.table)
function buildProductImageQuery(projectId) {
    const t = (name) => "`" + projectId + "." + name + "`";
    return `
Select distinct C.Value, B.Referencia, B.SKU_3
from ${t("JS_Designs.Products_Shopify")} A
left join ${t("JS_Designs.Products")} B
ON A.SKU = B.SKU
LEFT JOIN ${t("JS_Designs.Temp_Table")} C
ON B.SKU_3 = C.TAG_2 AND C.TAG = 'Image_supabase'
--WHERE b.sku_3 = '1570836586'
WHERE A.Variation_id = @variationId
`.trim();
}
exports.PRODUCT_IMAGE_NOT_FOUND = "PRODUCT_IMAGE_NOT_FOUND";
/**
 * Obtiene URL de imagen del producto y Referencia desde BigQuery.
 * Si no hay resultados o Value es null → lanza error PRODUCT_IMAGE_NOT_FOUND.
 */
async function getProductImageData(variationId) {
    const projectId = config_1.config.bigqueryProject || process.env.GCLOUD_PROJECT || "";
    if (!projectId) {
        throw new Error("BIGQUERY_PROJECT or GCLOUD_PROJECT must be set");
    }
    const bq = new bigquery_1.BigQuery({ projectId });
    const query = buildProductImageQuery(projectId);
    (0, logger_1.logInfo)("BigQuery getProductImageData", { variationId, projectId });
    const [job] = await bq.createQueryJob({
        query,
        useLegacySql: false,
        parameterMode: "NAMED",
        params: { variationId },
        types: { variationId: "STRING" }
    });
    const [rows] = await job.getQueryResults();
    if (!rows || rows.length === 0) {
        (0, logger_1.logError)("BigQuery no rows for product image", { variationId });
        throw new Error(exports.PRODUCT_IMAGE_NOT_FOUND);
    }
    const first = rows[0];
    const value = first?.Value ?? first?.value;
    if (value == null || value === "") {
        (0, logger_1.logError)("BigQuery Value null or empty for product image", { variationId });
        throw new Error(exports.PRODUCT_IMAGE_NOT_FOUND);
    }
    const ref = first?.Referencia ?? first?.referencia;
    const referencia = ref != null ? String(ref).trim() : "";
    const sku3Raw = first?.SKU_3 ?? first?.sku_3;
    const sku3 = sku3Raw != null ? String(sku3Raw).trim() : "";
    const productImageUrl = String(value).trim();
    (0, logger_1.logInfo)("BigQuery product image data", { variationId, urlLength: productImageUrl.length, referencia, sku3 });
    return { productImageUrl, referencia, sku3 };
}
/** Compatibilidad: devuelve solo la URL. */
async function getProductImageUrl(variationId) {
    const data = await getProductImageData(variationId);
    return data.productImageUrl;
}
