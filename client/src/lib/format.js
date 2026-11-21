const GB = 1024 ** 3;
const MB = 1024 ** 2;
const TB = 1024 ** 4;

/*
 * Sizes are formatted with Latin digits and a separate unit so the caller can
 * pin the number with `dir="ltr"` + `tabular-nums` without mixing scripts.
 */
const sizeDigits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const preciseDigits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const faDigit = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

/** Human readable size: auto-scales to TB, GB, or MB using binary (1024-based) units matching 3x-ui. */
export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return { value: '0', unit: 'GB' };
  if (value >= TB) {
    return { value: preciseDigits.format(value / TB), unit: 'TB' };
  }
  if (value >= GB) {
    return { value: preciseDigits.format(value / GB), unit: 'GB' };
  }
  return { value: sizeDigits.format(value / MB), unit: 'MB' };
}

export function formatSizeText(bytes) {
  const { value, unit } = formatSize(bytes);
  return `${value} ${unit}`;
}

/** Compact size for tight tiles: auto-scales to TB, GB, MB, or KB. Returns { value, unit }. */
export function formatBytesShort(bytes) {
  const v = Number(bytes) || 0;
  if (v >= TB) return { value: preciseDigits.format(v / TB), unit: 'TB' };
  if (v >= GB) return { value: preciseDigits.format(v / GB), unit: 'GB' };
  if (v >= MB) return { value: sizeDigits.format(v / MB), unit: 'MB' };
  return { value: sizeDigits.format(v / 1024), unit: 'KB' };
}

export function formatCount(value) {
  return sizeDigits.format(Number(value) || 0);
}

export function formatPercentFa(ratio) {
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  return `${faDigit.format(clamped * 100)}٪`;
}

export function formatDate(epochMs) {
  if (!epochMs) return 'نامحدود';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochMs));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
