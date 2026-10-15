import { formatTime, h } from './dom.js';

const MAX_ROWS = 150;

/** Every request the page makes on the visitor's behalf; background polling is hidden unless asked for. */
export function createRequestLog() {
  const body = h('tbody');
  const empty = h('p', { class: 'empty', text: 'Nothing yet. Join the queue or use a control and the calls show up here.' });
  const showPolling = h('input', { type: 'checkbox', id: 'log-polling' });
  const table = h('table', { class: 'log-table', hidden: true },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', text: 'Time' }), h('th', { scope: 'col', text: 'Request' }),
      h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Result' }), h('th', { scope: 'col', class: 'num', text: 'ms' }))),
    body,
  );

  const element = h('section', { class: 'panel log', 'aria-labelledby': 'log-title' },
    h('header', { class: 'panel-head' },
      h('h2', { id: 'log-title', text: 'Request log' }),
      h('label', { class: 'check', for: 'log-polling' }, showPolling, 'Include background polling'),
    ),
    empty,
    h('div', { class: 'table-scroll' }, table),
  );

  return {
    element,

    /** @param {import('./api.js').RequestRecord & { source: string }} record */
    add(record) {
      if (record.quiet && !showPolling.checked) return;
      const failed = record.status === null || record.status >= 400;
      const result = record.code ?? (record.replayed ? 'idempotent replay' : 'ok');
      body.prepend(h('tr', { class: failed ? 'is-error' : null },
        h('td', { class: 'num', text: formatTime(new Date()) }),
        h('td', {}, h('span', { class: 'log-source', text: record.source }), h('code', { text: `${record.method} ${record.path}` })),
        h('td', { class: 'num', text: record.status === null ? 'none' : String(record.status) }),
        h('td', {}, h('code', { text: record.code !== null && record.replayed ? `${result} (replayed)` : result })),
        h('td', { class: 'num', text: String(record.durationMs) }),
      ));
      while (body.childElementCount > MAX_ROWS) body.lastElementChild.remove();
      empty.hidden = true;
      table.hidden = false;
    },
  };
}
