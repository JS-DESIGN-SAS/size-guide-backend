import { config } from "./config";
import { logInfo, logError } from "../shared/logger";

const DATA_URL_PREFIX = /^data:image\/[a-z+]+;base64,/i;

interface FashnStatusPayload {
  id?: string;
  status?: string;
  output?: string[];
  error?: { name?: string; message?: string };
}

export interface FashnTryonInput {
  /** URL de la imagen del producto (prenda). */
  productImageUrl: string;
  /** Imagen del modelo/usuario en base64 (sin prefijo data URL). */
  modelImageBase64: string;
  /** MIME type de la imagen del modelo (ej. image/jpeg). */
  modelImageMimeType: string;
  /** Prompt opcional (ej. "tuck in shirt", "open jacket"). */
  prompt?: string;
}

/**
 * Construye data URL para imagen: data:image/jpeg;base64,...
 */
function toDataUrl(mimeType: string, base64: string): string {
  const mime = mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

/**
 * Extrae base64 puro de un string que puede ser data URL o base64 directo.
 */
function stripDataUrlPrefix(value: string): string {
  return value.replace(DATA_URL_PREFIX, "").trim();
}

/**
 * Llama a FASHN Try-On Max: POST /v1/run y polling a /v1/status/{id}.
 * Devuelve la imagen resultante en base64 (sin prefijo data URL).
 * Ver: https://docs.fashn.ai/api-reference/tryon-max y https://docs.fashn.ai/api-overview/api-fundamentals#status-polling
 */
export async function runFashnTryon(input: FashnTryonInput): Promise<string> {
  const apiKey = config.fashnApiKey;
  if (!apiKey) {
    throw new Error("FASHN_API_KEY is not set");
  }

  const baseUrl = config.fashnBaseUrl;
  const modelImage = toDataUrl(input.modelImageMimeType, input.modelImageBase64);

  const runBody = {
    model_name: "tryon-max",
    inputs: {
      product_image: input.productImageUrl,
      model_image: modelImage,
      prompt: input.prompt ?? "",
      output_format: "png",
      return_base64: true,
      num_images: 1,
      seed: 42
    }
  };

  logInfo("fashn tryon run", { baseUrl, productUrlLength: input.productImageUrl.length });

  const runRes = await fetch(`${baseUrl}/v1/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(runBody)
  });

  const runData = (await runRes.json()) as { id?: string; error?: { message?: string } };
  if (!runRes.ok) {
    const msg = runData?.error?.message ?? runRes.statusText;
    logError("fashn tryon run failed", { status: runRes.status, message: msg });
    throw new Error(`FASHN run failed: ${msg}`);
  }
  if (runData.error) {
    throw new Error(runData.error.message ?? "FASHN run error");
  }
  const id = runData.id;
  if (!id) {
    throw new Error("FASHN run returned no id");
  }

  logInfo("fashn tryon polling", { id });

  // Tiempo típico ~50s: esperar 35s antes del primer poll para no gastar recursos.
  const initialWaitMs = 38 * 1000; // 35 segundos
  const pollIntervalMs = 3500; // 3–5s entre polls tras la espera inicial
  const maxDelayMs = 5000;
  const timeoutMs = 2 * 60 * 1000; // 2 min total
  const start = Date.now();

  await new Promise((r) => setTimeout(r, initialWaitMs));

  let delayMs = pollIntervalMs;

  while (true) {
    if (Date.now() - start > timeoutMs) {
      logError("fashn tryon timeout", { id });
      throw new Error("Timeout esperando resultado de FASHN");
    }

    const statusRes = await fetch(`${baseUrl}/v1/status/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const raw = await statusRes.json();
    const st: FashnStatusPayload = Array.isArray(raw) && raw[0]?.body
      ? raw[0].body
      : (raw as FashnStatusPayload);

    if (st.status === "completed") {
      const output = st.output;
      if (!output || output.length === 0) {
        throw new Error("FASHN completed but no output");
      }
      const first = output[0];
      const base64 = typeof first === "string" ? stripDataUrlPrefix(first) : "";
      if (!base64) {
        throw new Error("FASHN output empty or invalid");
      }
      logInfo("fashn tryon success", { id, imageBase64Length: base64.length });
      return base64;
    }

    if (st.status === "failed") {
      const errMsg = st.error?.message ?? st.error?.name ?? "Prediction failed";
      logError("fashn tryon failed", { id, error: errMsg });
      throw new Error(`FASHN prediction failed: ${errMsg}`);
    }

    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(Math.floor(delayMs * 1.2), maxDelayMs);
  }
}
