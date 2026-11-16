/**
 * Clipboard write with a fallback for non-secure origins (plain HTTP admin
 * pages) and older browsers where `navigator.clipboard` is unavailable.
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('nothing to copy');

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, value.length);
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('copy failed');
  return true;
}
