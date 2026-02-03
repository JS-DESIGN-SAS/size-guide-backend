"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGeminiTryon = runGeminiTryon;
const genai_1 = require("@google/genai");
const config_1 = require("./config");
const logger_1 = require("../shared/logger");
/**
 * Obtiene la primera palabra de una cadena (para el prompt de virtual try-on).
 */
function getFirstWord(referencia) {
    const trimmed = referencia.trim();
    const space = trimmed.indexOf(" ");
    return space === -1 ? trimmed : trimmed.slice(0, space);
}
/**
 * Construye el prompt de Virtual Try-On para Gemini.
 */
function buildTryonPrompt(firstWord, productName) {
    return `
Actúa como un experto en moda digital y retoque fotográfico de alta gama.

OBJETIVO: Realizar un "Virtual Try-On" de ultra alta fidelidad.

CONTEXTO: El usuario quiere probarse un/a ${firstWord} (${productName}).

ENTRADAS:
1. IMAGEN DE REFERENCIA (Prenda): La ropa exacta que se debe usar (${productName}).
2. IMAGEN DESTINO (Usuario): La persona que se probará la ropa.

INSTRUCCIÓN PRINCIPAL:
- Reemplaza ÚNICAMENTE el/la ${firstWord} que el usuario está usando con el/la ${firstWord} de la Imagen 1.
- NO modifiques ninguna otra prenda, accesorio, parte del cuerpo, cara, fondo ni ningún otro elemento.
- Solo cambia el/la ${firstWord} específico/a que se muestra en la imagen de referencia.

INSTRUCCIONES CRÍTICAS DE PRESERVACIÓN DE DETALLE (MÁXIMA PRIORIDAD):
- Tu misión es TRANSFERIR el/la ${firstWord} de la Imagen 1 a la Imagen 2 conservando TODO EL DETALLE posible.
- TEXTURA Y TEJIDO: Replica exactamente la granularidad de la tela (denim, seda, algodón, lana). Se debe "sentir" el material.
- MICRO-DETALLES: Conserva costuras, botones, cremalleras, remaches, etiquetas visibles, bordados y dobladillos. No los simplifiques ni los elimines.
- ESTAMPADOS Y LOGOS: Si el/la ${firstWord} tiene gráficos, textos o patrones, deben ser transferidos con precisión quirúrgica. No los deformes.
- FORMA Y CAÍDA: Respeta el corte del/la ${firstWord}. Si es rígido/a, que se vea rígido/a; si es fluido/a, que tenga caída.

FIDELIDAD DIMENSIONAL:
- Mantén las proporciones originales del/la ${firstWord} (largo de mangas, ancho de hombros, largo total, etc.).
- Si el/la ${firstWord} es "oversize", debe verse grande en el usuario. Si es "slim fit", debe verse ajustado/a.

REGLAS GENERALES:
- Iluminación fotorrealista: Aplica sombras y luces coherentes con la foto del usuario sobre el nuevo/a ${firstWord}.
- Cero alucinaciones: No inventes accesorios que no existen en la imagen de referencia.
- PRESERVACIÓN DEL USUARIO: No cambies la cara, el cuerpo, el tono de piel, otras prendas, accesorios ni el fondo.

RESTRICCIONES CRÍTICAS DE ENCUADRE Y PROPORCIÓN:
- PROPORCIÓN EXACTA: La imagen resultante DEBE tener exactamente la misma proporción (aspect ratio) que la Imagen 2 (usuario). Si es vertical, mantén vertical. Si es horizontal, mantén horizontal.
- SIN EXTENSIONES: NO agregues más espacio alrededor de la imagen. NO extiendas el fondo. NO agregues partes del cuerpo que no estaban visibles en la imagen original.
- ENCUADRE IDÉNTICO: Mantén exactamente el mismo encuadre que la imagen del usuario. Si solo se veía hasta la cintura, mantén hasta la cintura. Si se veía cuerpo completo, mantén cuerpo completo.
- SIN RECORTES: No recortes partes de la imagen original. La imagen resultante debe mostrar exactamente la misma área que la imagen del usuario, solo con el/la ${firstWord} cambiado/a.

Genera SOLO la imagen resultante final con las mismas dimensiones y proporción que la imagen del usuario.
`.trim();
}
/**
 * Descarga la imagen del producto desde la URL y la devuelve en base64 con su MIME type.
 */
async function fetchProductImageAsBase64(productImageUrl) {
    const res = await fetch(productImageUrl, { method: "GET" });
    if (!res.ok) {
        throw new Error(`Failed to fetch product image: ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim().toLowerCase() || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const data = buffer.toString("base64");
    return { data, mimeType };
}
/**
 * Llama al modelo Gemini para virtual try-on: recibe imagen de producto + imagen del usuario,
 * devuelve la imagen generada en base64.
 */
async function runGeminiTryon(input) {
    const apiKey = config_1.config.geminiApiKey;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set");
    }
    const referencia = (input.referencia || "").trim() || "prenda";
    const firstWord = getFirstWord(referencia);
    const productName = referencia;
    const prompt = buildTryonPrompt(firstWord, productName);
    (0, logger_1.logInfo)("gemini tryon fetch product image", { urlLength: input.productImageUrl.length });
    const productImage = await fetchProductImageAsBase64(input.productImageUrl);
    const ai = new genai_1.GoogleGenAI({ apiKey });
    const contents = [
        { text: prompt },
        {
            inlineData: {
                mimeType: productImage.mimeType,
                data: productImage.data
            }
        },
        {
            inlineData: {
                mimeType: input.userImageMimeType,
                data: input.userImageBase64
            }
        }
    ];
    (0, logger_1.logInfo)("gemini tryon generateContent", {
        model: config_1.config.geminiTryonModel,
        firstWord,
        productNameLength: productName.length
    });
    const response = await ai.models.generateContent({
        model: config_1.config.geminiTryonModel,
        contents,
        config: {
            responseModalities: ["TEXT", "IMAGE"]
        }
    });
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
        const blockReason = response.promptFeedback?.blockReason;
        (0, logger_1.logError)("gemini tryon no candidates", { blockReason });
        throw new Error(blockReason ? `Gemini blocked: ${blockReason}` : "Gemini returned no candidates");
    }
    const parts = candidates[0].content?.parts ?? [];
    let lastImageBase64 = null;
    for (const part of parts) {
        if (part.thought)
            continue;
        const inlineData = part.inlineData;
        if (inlineData?.data) {
            lastImageBase64 = inlineData.data;
        }
    }
    if (!lastImageBase64) {
        (0, logger_1.logError)("gemini tryon no image in response", { partsCount: parts.length });
        throw new Error("Gemini did not return an image");
    }
    (0, logger_1.logInfo)("gemini tryon success", { imageBase64Length: lastImageBase64.length });
    return lastImageBase64;
}
