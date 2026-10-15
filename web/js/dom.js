/**
 * Element builder. Props starting with "on" attach listeners; `class`, `text`, `dataset`
 * and `hidden` are handled directly; `false`/`null`/`undefined` props are skipped;
 * everything else becomes an attribute.
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Node | string | null | false | undefined)} children
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'class') el.className = value;
    else if (name === 'text') el.textContent = value;
    else if (name === 'hidden') el.hidden = true;
    else if (name === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  el.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
  return el;
}

export function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const formatDate = (iso) => dateFormat.format(new Date(iso));
export const formatTime = (date) => timeFormat.format(date);

/** "7:42" for a remaining duration; never negative. */
export function formatCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
