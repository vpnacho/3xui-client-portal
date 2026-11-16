const GB = 1024 ** 3;
const MB = 1024 ** 2;

/*
 * Sizes are formatted with Latin digits and a separate unit so the caller can
 * pin the number with `dir="ltr"` + `tabular-nums` without mixing scripts.
 */
const sizeDigits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const preciseDigits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const faDigit = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

/** Human readable size, preferring GB but falling back to MB for tiny values. */
export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return { value: '0', unit: 'GB' };
  if (value < GB) {
    return { value: sizeDigits.format(value / MB), unit: 'MB' };
  }
  return { value: preciseDigits.format(value / GB), unit: 'GB' };
}

export function formatSizeText(bytes) {
  const { value, unit } = formatSize(bytes);
  return `${value} ${unit}`;
}

/** Compact "1.5 GB" string for tight tiles. */
export function formatBytesShort(bytes) {
  const value = Number(bytes) || 0;
  if (value < MB) return `${sizeDigits.format(value / 1024)} KB`;
  if (value < GB) return `${sizeDigits.format(value / MB)} MB`;
  return `${preciseDigits.format(value / GB)} GB`;
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
