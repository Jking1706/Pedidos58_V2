const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIME_ZONE || 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => Number(parts.find((item) => item.type === type).value);
  return new Date(part('year'), part('month') - 1, part('day'));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function startOfMonth(date = businessDate()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatIsoDate(date = businessDate()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatOrderDate(date = businessDate()) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function rangeDays(desde, hasta) {
  const from = new Date(`${desde}T00:00:00Z`);
  const to = new Date(`${hasta}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 1;
  }

  const diffMs = Math.abs(to.getTime() - from.getTime());
  return Math.max(1, Math.floor(diffMs / 86400000) + 1);
}

function parseIsoDate(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const text = String(value).trim();
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!ISO_DATE_RE.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text || text < '0001-01-01') {
    throw Object.assign(new Error(`${label} debe tener formato YYYY-MM-DD`), { statusCode: 400 });
  }

  return text;
}

function resolvePresetRange(preset, baseDate = businessDate()) {
  const today = formatIsoDate(baseDate);

  switch (String(preset || '').trim().toLowerCase()) {
    case 'hoy':
      return { desde: today, hasta: today, preset: 'hoy' };
    case 'ayer': {
      const date = formatIsoDate(shiftDays(baseDate, -1));
      return { desde: date, hasta: date, preset: 'ayer' };
    }
    case 'semana':
      return { desde: formatIsoDate(shiftDays(baseDate, -((baseDate.getDay() + 6) % 7))), hasta: today, preset: 'semana' };
    case '30dias':
      return { desde: formatIsoDate(shiftDays(baseDate, -29)), hasta: today, preset: '30dias' };
    case 'mes':
    default:
      return { desde: formatIsoDate(startOfMonth(baseDate)), hasta: today, preset: 'mes' };
  }
}

function resolveRange(input = {}, { defaultPreset = 'mes' } = {}) {
  const get = typeof input?.get === 'function'
    ? (key) => input.get(key)
    : (key) => input?.[key];

  const preset = String(get('preset') || '').trim().toLowerCase();
  const fallback = resolvePresetRange(defaultPreset);
  const presetRange = preset && preset !== 'personalizado' ? resolvePresetRange(preset) : fallback;
  const desde = parseIsoDate(get('desde'), presetRange.desde, 'La fecha inicial');
  const hasta = parseIsoDate(get('hasta'), presetRange.hasta, 'La fecha final');
  const normalized = desde > hasta ? { desde: hasta, hasta: desde } : { desde, hasta };
  if (rangeDays(normalized.desde, normalized.hasta) > 366) {
    throw Object.assign(new Error('El rango máximo es de 366 días; divide el reporte en períodos menores'), { statusCode: 400 });
  }

  return {
    desde: normalized.desde,
    hasta: normalized.hasta,
    preset: preset || presetRange.preset,
    dias: rangeDays(normalized.desde, normalized.hasta),
  };
}

function isoToOrderDate(value) {
  return formatOrderDate(new Date(`${value}T00:00:00`));
}

module.exports = {
  businessDate,
  formatIsoDate,
  formatOrderDate,
  isoToOrderDate,
  parseIsoDate,
  rangeDays,
  resolvePresetRange,
  resolveRange,
  shiftDays,
  startOfMonth,
  toAmount,
  toInt,
};
