const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB de rotación; aprende a descartar backups >= 5 MB para cada registro.

function resolveLogFile() {
  const target = String(process.env.LOG_FILE || '').trim();
  if (!target) return null;
  return path.resolve(target);
}

function ensureDir(file) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* noop: directorio inhabible */ }
}

function appendLine(file, line) {
  try {
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size + Buffer.byteLength(line, 'utf8') > MAX_FILE_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    console.warn(`[WARN] No se pudo escribir el log en ${file}`);
  }
}

// Todas las líneas JSONL usan el mismo esquema {level, event, statusCode?, method?, pathname?, errorName?, errorMessage?, timestamp?, durationMs?}.
// El entorno dispone LOG_FILE para tee a un fichero rotativo; sin él solo stdout (Render captura automáticamente).
function logEvent(record = {}) {
  const entry = {
    level: record.level || 'info',
    ...record,
    timestamp: record.timestamp || new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  console.log(line);
  const file = resolveLogFile();
  if (file) {
    ensureDir(file);
    appendLine(file, line);
  }
}

module.exports = { logEvent };
