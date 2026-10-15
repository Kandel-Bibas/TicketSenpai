import { createApi, NetworkError } from './api.js';
import { createCrowd } from './crowd.js';
import { createCrowdPanel } from './crowdPanel.js';
import { formatDate, h, money } from './dom.js';
import { createOperator } from './operator.js';
import { createProbes } from './probes.js';
import { createRequestLog } from './requestLog.js';
import { createShopper } from './shopper.js';

const DEFAULT_API = 'http://127.0.0.1:4010';
const THEME_KEY = 'ticketing-demo-theme';

const app = document.getElementById('app');
const alerts = document.getElementById('alerts');

function showAlert(id, message) {
  let el = alerts.querySelector(`[data-alert="${id}"]`);
  if (message === null) return el?.remove();
  if (!el) {
    el = h('p', { class: 'alert', role: 'alert', dataset: { alert: id } });
    alerts.append(el);
  }
  el.textContent = message;
}

// Nothing fails silently: an error no panel handled is put in front of the visitor.
window.addEventListener('error', (event) => showAlert('crash', `The page hit an error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => showAlert('crash', `The page hit an error: ${event.reason?.message ?? event.reason}`));

function readApiBase() {
  const given = new URLSearchParams(location.search).get('api');
  if (given === null) return DEFAULT_API;
  let url;
  try {
    url = new URL(given);
  } catch {
    throw new Error(`The "api" query parameter is not a URL: ${given}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`The "api" query parameter must be an http(s) URL, got ${url.protocol}`);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function setUpThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const current = () => document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
  const label = () => { button.textContent = current() === 'dark' ? 'Use light theme' : 'Use dark theme'; };
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    label();
  });
  systemDark.addEventListener('change', label);
  label();
}

const SALE_STATES = { on_sale: 'On sale now', paused: 'Sales paused', sold_out: 'Sold out' };

function eventHeader(event) {
  const saleState = h('p', { class: 'sale-state' });
  const element = h('header', { class: 'event' },
    h('div', {},
      h('h1', { text: event.name }),
      h('p', { class: 'event-meta', text: `${event.venue}, ${formatDate(event.startsAt)}. Up to ${event.seatLimitPerAccount} seats per account.` })),
    h('div', { class: 'event-side' },
      saleState,
      h('ul', { class: 'tiers' }, ...event.priceTiers.map((tier) => h('li', {}, h('span', { text: tier.tier }), h('span', { class: 'num', text: money(tier.priceCents, event.currency) }))))),
  );
  return {
    element,
    setSaleState(state) {
      const words = state === 'scheduled' ? `On sale at ${new Date(event.onSaleAt).toLocaleTimeString()}` : SALE_STATES[state];
      if (words === undefined) throw new Error(`Sale state this page does not know: ${state}`);
      saleState.textContent = words;
    },
  };
}

async function boot(baseUrl) {
  app.replaceChildren(h('p', { class: 'boot', role: 'status', text: `Connecting to ${baseUrl}…` }));

  const log = createRequestLog();
  const apiFor = (source) => createApi({ baseUrl, onRequest: (record) => log.add({ ...record, source }) });
  const shopperApi = apiFor('shopper');

  let event;
  let seatMapData;
  try {
    const { items } = await shopperApi.listEvents();
    if (items.length === 0) throw new Error(`${baseUrl} lists no events, so there is nothing to demo.`);
    [event] = items;
    seatMapData = await shopperApi.getSeatMap(event.eventId);
  } catch (err) {
    const message = err instanceof NetworkError
      ? `Nothing is answering at ${baseUrl}. Start the backend with "npm start" in the repo root, then retry. A backend elsewhere can be given as ?api=http://host:port.`
      : err.message;
    app.replaceChildren(h('div', { class: 'boot' },
      h('h1', { text: 'The backend is not reachable' }),
      h('p', { role: 'alert', text: message }),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Retry', onClick: () => boot(baseUrl) })));
    return;
  }

  const header = eventHeader(event);
  header.setSaleState(event.saleState);

  const shopper = createShopper({ api: shopperApi, event, seatMapData });
  const operator = createOperator({
    api: apiFor('operator'),
    eventId: event.eventId,
    onConnection: (online) => showAlert('offline', online ? null : `Lost contact with ${baseUrl}. Retrying every second; if the backend restarted, its state is gone and you will need to rejoin the queue.`),
    onDashboard: (dashboard) => header.setSaleState(dashboard.saleState),
  });

  // Bot traffic stays out of the request log; it would bury the visitor's own calls.
  let crowdPanel = null;
  let crowdFrame = 0;
  const crowd = createCrowd({
    api: createApi({ baseUrl }),
    eventId: event.eventId,
    seatMap: seatMapData,
    seatLimit: event.seatLimitPerAccount,
    onChange() {
      cancelAnimationFrame(crowdFrame);
      crowdFrame = requestAnimationFrame(() => crowdPanel.update());
    },
  });
  crowdPanel = createCrowdPanel({ crowd });

  const probes = createProbes({ api: apiFor('probe'), eventId: event.eventId, sections: seatMapData.sections.map((s) => s.section), shopper });

  app.replaceChildren(
    header.element,
    h('div', { class: 'layout' },
      h('div', { class: 'layout-main' }, shopper.element, probes.element, log.element),
      h('div', { class: 'layout-side' }, operator.element, crowdPanel.element)),
  );
  operator.start();
}

setUpThemeToggle();
try {
  await boot(readApiBase());
} catch (err) {
  showAlert('crash', err.message);
  console.error(err);
}
