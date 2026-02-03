import { google } from "googleapis";
import { Readable } from "stream";
import { config } from "./config";
import { logInfo, logError } from "../shared/logger";

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
export async function uploadUserPhotoToDrive(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  const folderId = config.driveFolderId?.trim();
  if (!folderId) {
    return null;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.file"]
    });
    const drive = google.drive({ version: "v3", auth });

    const stream = Readable.from(buffer);
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
      logInfo("drive upload", { fileId, filename });
      return fileId;
    }
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logError("drive upload failed", { filename, error: message });
    throw new Error(`Drive upload failed: ${message}`);
  }
}
