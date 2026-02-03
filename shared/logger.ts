export function logInfo(message: string, extra: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ level: "INFO", message, ...extra }));
  }
  
  export function logError(message: string, extra: Record<string, unknown> = {}) {
    console.error(JSON.stringify({ level: "ERROR", message, ...extra }));
  }
  