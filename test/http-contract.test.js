import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, EVENT } from './helpers.js';

test('error responses carry error.code, error.message, error.requestId and X-Request-Id; a client id is echoed', async () => {
  const mock = await startMock();
  try {
    const res = await mock.call('GET', '/events/evt_bogus');
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error.code, 'string');
    assert.equal(typeof res.body.error.message, 'string');
    assert.equal(typeof res.body.error.requestId, 'string');
    assert.equal(res.headers.get('x-request-id'), res.body.error.requestId);

    const withCustomId = await mock.call('GET', '/events/evt_bogus', { headers: { 'X-Request-Id': 'custom-request-id-123' } });
    assert.equal(withCustomId.status, 404);
    assert.equal(withCustomId.body.error.requestId, 'custom-request-id-123');
    assert.equal(withCustomId.headers.get('x-request-id'), 'custom-request-id-123');
  } finally {
    await mock.close();
  }
});

test('unknown path, wrong method, invalid JSON, oversized body, unknown event id', async () => {
  const mock = await startMock();
  try {
    const notFound = await mock.call('GET', '/totally/unknown/path');
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error.code, 'not_found');

    const wrongMethod = await mock.call('POST', '/healthz');
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
    assert.equal(typeof wrongMethod.headers.get('allow'), 'string');

    const token = await mock.admit('contract-1');

    const invalidJson = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'contract-1', token, key: 'contract-invalid-json', rawBody: '{',
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.error.code, 'invalid_json');

    const oversized = await mock.call('POST', `/events/${EVENT}/holds`, {
      account: 'contract-1', token, key: 'contract-oversized', rawBody: 'x'.repeat(70_000),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, 'payload_too_large');

    const unknownEvent = await mock.call('GET', '/events/evt_does_not_exist');
    assert.equal(unknownEvent.status, 404);
    assert.equal(unknownEvent.body.error.code, 'event_not_found');
  } finally {
    await mock.close();
  }
});

test('GET /events pagination and GET /events/:id shape', async () => {
  const mock = await startMock();
  try {
    const paged = await mock.call('GET', '/events?limit=1');
    assert.equal(paged.status, 200);
    assert.equal(paged.body.items.length, 1);
    assert.equal(paged.body.items[0].eventId, EVENT);
    assert.equal(paged.body.nextCursor, null);

    const limitZero = await mock.call('GET', '/events?limit=0');
    assert.equal(limitZero.status, 400);
    assert.equal(limitZero.body.error.code, 'invalid_request');

    const limitTooBig = await mock.call('GET', '/events?limit=51');
    assert.equal(limitTooBig.status, 400);
    assert.equal(limitTooBig.body.error.code, 'invalid_request');

    const event = await mock.call('GET', `/events/${EVENT}`);
    assert.equal(event.status, 200);
    assert.equal(event.body.saleState, 'on_sale');
    assert.ok(!Number.isNaN(Date.parse(event.body.startsAt)));
    assert.ok(!Number.isNaN(Date.parse(event.body.onSaleAt)));
    assert.ok(Array.isArray(event.body.priceTiers));
    assert.ok(event.body.priceTiers.length > 0);
    for (const tier of event.body.priceTiers) {
      assert.equal(typeof tier.tier, 'string');
      assert.ok(Number.isInteger(tier.priceCents));
    }
  } finally {
    await mock.close();
  }
});

test('GET /events/:id/seat-map has 3 sections sized 50/120/100 with an immutable cache header', async () => {
  const mock = await startMock();
  try {
    const res = await mock.call('GET', `/events/${EVENT}/seat-map`);
    assert.equal(res.status, 200);
    assert.equal(res.body.sections.length, 3);
    const bySection = new Map(res.body.sections.map((s) => [s.section, s]));
    assert.equal(bySection.get('A').seats.length, 50);
    assert.equal(bySection.get('B').seats.length, 120);
    assert.equal(bySection.get('GA').seats.length, 100);
    assert.match(res.headers.get('cache-control'), /immutable/);
  } finally {
    await mock.close();
  }
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const mock = await startMock();
  try {
    const res = await mock.call('OPTIONS', '/events');
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    await mock.close();
  }
});

test('GET /healthz returns 200', async () => {
  const mock = await startMock();
  try {
    const res = await mock.call('GET', '/healthz');
    assert.equal(res.status, 200);
  } finally {
    await mock.close();
  }
});
