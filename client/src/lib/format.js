const GB = 1024 ** 3;
const MB = 1024 ** 2;

const digits = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });

/** Human readable size, preferring GB and falling back to MB for tiny values. */
export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return { value: digits.format(0), unit: 'GB' };
  if (value < GB) {
    return { value: digits.format(value / MB), unit: 'MB' };
  }
  return { value: precise.format(value / GB), unit: 'GB' };
}

export function formatSizeText(bytes) {
  const { value, unit } = formatSize(bytes);
  return `${value} ${unit}`;
}

export function formatBytesShort(bytes) {
  const value = Number(bytes) || 0;
  if (value < MB) return `${digits.format(value / 1024)} KB`;
  if (value < GB) return `${digits.format(value / MB)} MB`;
  return `${precise.format(value / GB)} GB`;
}

export function formatPercent(ratio) {
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  return `${precise.format(clamped * 100)}٪`;
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
