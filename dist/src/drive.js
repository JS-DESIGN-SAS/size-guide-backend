"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadUserPhotoToDrive = uploadUserPhotoToDrive;
const googleapis_1 = require("googleapis");
const stream_1 = require("stream");
const config_1 = require("./config");
const logger_1 = require("../shared/logger");
/**
 * Sube un buffer como archivo a una carpeta de Google Drive.
 * Usa ADC (Application Default Credentials): en Cloud Run usa la service account del servicio.
 * La carpeta debe estar compartida con el email de esa service account.
 *
 * @param buffer - Contenido del archivo
 * @param mimeType - Ej. image/jpeg, image/png
 * @param filename - Nombre del archivo (ej. SKU_3_1706543123456.jpg)
 * @returns ID del archivo creado en Drive, o null si no hay folderId configurado
 */
async function uploadUserPhotoToDrive(buffer, mimeType, filename) {
    const folderId = config_1.config.driveFolderId?.trim();
    if (!folderId) {
        return null;
    }
    try {
        const auth = new googleapis_1.google.auth.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/drive.file"]
        });
        const drive = googleapis_1.google.drive({ version: "v3", auth });
        const stream = stream_1.Readable.from(buffer);
        const res = await drive.files.create({
            supportsAllDrives: true,
            requestBody: {
                name: filename,
                parents: [folderId]
            },
            media: {
                mimeType,
                body: stream
            }
        });
        const fileId = res.data.id;
        if (fileId) {
            (0, logger_1.logInfo)("drive upload", { fileId, filename });
            return fileId;
        }
        return null;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        (0, logger_1.logError)("drive upload failed", { filename, error: message });
        throw new Error(`Drive upload failed: ${message}`);
    }
}
