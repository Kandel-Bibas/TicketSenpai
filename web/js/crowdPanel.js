import { h } from './dom.js';

const MAX_PER_SEND = 500;

/** @param {{ crowd: ReturnType<import('./crowd.js').createCrowd> }} options */
export function createCrowdPanel({ crowd }) {
  const count = h('input', { type: 'number', id: 'crowd-count', min: 1, max: MAX_PER_SEND, value: 150, inputmode: 'numeric' });
  const status = h('p', { class: 'control-status', role: 'status' });
  const cells = Object.fromEntries(['queued', 'shopping', 'paying', 'bought', 'gaveUp', 'failed'].map((name) => [name, h('dd', { class: 'num', text: '0' })]));
  const labels = { queued: 'In the queue', shopping: 'Choosing seats', paying: 'Paying', bought: 'Got tickets', gaveUp: 'Left empty-handed', failed: 'Hit an error' };

  const form = h('form', { class: 'crowd-form', onSubmit: (event) => {
    event.preventDefault();
    const n = Number(count.value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_SEND) {
      status.classList.add('is-error');
      status.textContent = `Send between 1 and ${MAX_PER_SEND} shoppers at a time.`;
      return;
    }
    status.classList.remove('is-error');
    status.textContent = `${n} shoppers are on their way to the queue.`;
    crowd.send(n);
  } },
    h('label', { for: 'crowd-count', text: 'Simulated shoppers to send' }),
    h('div', { class: 'row' }, count,
      h('button', { type: 'submit', class: 'btn btn-primary', text: 'Send shoppers' }),
      h('button', { type: 'button', class: 'btn btn-quiet', text: 'Stop them', onClick: () => { crowd.stop(); status.classList.remove('is-error'); status.textContent = 'Shoppers stop after their current request.'; } })),
  );

  return {
    element: h('section', { class: 'panel crowd', 'aria-labelledby': 'crowd-title' },
      h('header', { class: 'panel-head' },
        h('h2', { id: 'crowd-title', text: 'Crowd' }),
        h('p', { class: 'hint', text: 'Bots that queue, race for seats and pay with a mix of good and bad cards. Set a release rate of 2 in the control room first to watch a line form, then join it yourself.' })),
      form,
      h('dl', { class: 'stats' }, ...Object.entries(cells).map(([name, cell]) => h('div', { class: 'stat' }, h('dt', { text: labels[name] }), cell))),
      status),

    // Wired to the crowd's onChange.
    update() {
      const stats = crowd.stats();
      for (const [name, cell] of Object.entries(cells)) cell.textContent = stats[name];
      cells.failed.parentElement.classList.toggle('is-bad', stats.failed > 0);
      if (stats.failed > 0) {
        status.classList.add('is-error');
        status.textContent = `Last bot error: ${crowd.lastFailure()}`;
      }
    },
  };
}
