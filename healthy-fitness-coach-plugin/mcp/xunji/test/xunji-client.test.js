function train(date='2026-08-01', id=1, title='胸部训练') { return {datestr:date, ...(id ? {localid:id} : {}), start:1785622384301,end:1785627630605,title,note:'',movements:[{name:'杠铃卧推',sets:[{done:true,weight:'60',unit:'kg',reps:'10'}]}]}; }
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { gzipSync } = require('node:zlib');
const test = require('node:test');

const { decodeXunjiResponse, XunjiClient } = require('../src/xunji-client.js');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('client posts v2 schema and datestr to an injected localhost endpoint', async () => {
  await withServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      assert.equal(request.method, 'POST');
      assert.deepEqual(JSON.parse(body), { schema_version:'train_open_api_v2', datestr:'2026-08-01', include_full_data:false });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ success: true, res: [] }));
    });
  }, async (baseUrl) => {
    const client = new XunjiClient({ baseUrl, timeoutMs: 500 });
    const result = await client.fetchDay('2026-08-01', 'FAKE_TEST_CREDENTIAL');
    assert.deepEqual(result.records, []);
  });
});

test('decoder accepts deterministic gzipped buffers', () => {
  const response = gzipSync(Buffer.from(JSON.stringify({ success: true, res: ['id: local-only'] })));
  assert.deepEqual(decodeXunjiResponse(response).records, ['id: local-only']);
});

test('decoder accepts the official response shape when success is omitted', () => {
  assert.deepEqual(decodeXunjiResponse(JSON.stringify({ res: [] })).records, []);
});

test('client maps auth, rate-limit, invalid JSON, and timeout without exposing credentials', async () => {
  await withServer((request, response) => {
    if (request.url === '/auth') { response.statusCode = 401; response.end('no'); return; }
    if (request.url === '/rate') { response.statusCode = 429; response.end('no'); return; }
    if (request.url === '/json') { response.end('not json'); return; }
    if (request.url === '/slow') { setTimeout(() => response.end(JSON.stringify({ success: true, res: [] })), 100); }
  }, async (baseUrl) => {
    for (const [path, code, timeoutMs] of [['/auth', 'invalid_credentials', 500], ['/rate', 'rate_limited', 500], ['/json', 'invalid_response', 500], ['/slow', 'network_error', 10]]) {
      const client = new XunjiClient({ baseUrl: `${baseUrl}${path}`, timeoutMs });
      await assert.rejects(client.fetchDay('2026-08-01', 'FAKE_TEST_CREDENTIAL'), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes('FAKE_TEST_CREDENTIAL'), false);
        return true;
      });
    }
  });
});

test('client rejects a localhost success-false response as invalid_response', async () => {
  await withServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: false, res: [] }));
  }, async (baseUrl) => {
    const client = new XunjiClient({ baseUrl, timeoutMs: 500 });
    await assert.rejects(client.fetchDay('2026-08-01', 'FAKE_TEST_CREDENTIAL'), { code: 'invalid_response' });
  });
});

test('client maps documented business errors returned in res', async () => {
  await withServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: false, res: 'too frequent, retry after 13s' }));
  }, async (baseUrl) => {
    const client = new XunjiClient({ baseUrl, timeoutMs: 500 });
    await assert.rejects(client.fetchDay('2026-08-01', 'FAKE_TEST_CREDENTIAL'), (error) => {
      assert.equal(error.code, 'rate_limited');
      assert.equal(JSON.stringify(error).includes('FAKE_TEST_CREDENTIAL'), false);
      return true;
    });
  });
});

test('client upserts records to the dedicated endpoint and returns server records', async () => {
  await withServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      assert.equal(request.url, '/api_upsert_trains_for_llm_v2');
      assert.equal(request.headers.authorization.startsWith('Bearer '), true);
      assert.equal(request.headers.authorization.endsWith('FAKE_TEST_CREDENTIAL'), true);
      const payload=JSON.parse(body); assert.equal(payload.schema_version,'train_open_api_v2'); assert.ok(payload.client_request_id); assert.equal(payload.dry_run,false); assert.equal(payload.include_full_data,true); assert.deepEqual(payload.res,[train()]);
      response.end(JSON.stringify({ success: true, res: [train()] }));
    });
  }, async (baseUrl) => {
    const client = new XunjiClient({ baseUrl, timeoutMs: 500 });
    const result = await client.upsertRecords([train()], 'FAKE_TEST_CREDENTIAL');
    assert.deepEqual(result.records, [train()]);
  });
});

test('client maps documented Xunji business errors without leaking credentials', async () => {
  await withServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: false, error: '仅VIP可用' }));
  }, async (baseUrl) => {
    const client = new XunjiClient({ baseUrl, timeoutMs: 500 });
    await assert.rejects(client.upsertRecords([train()], 'FAKE_TEST_CREDENTIAL'), (error) => {
      assert.equal(error.code, 'membership_required');
      assert.equal(JSON.stringify(error).includes('FAKE_TEST_CREDENTIAL'), false);
      return true;
    });
  });
});
