// -----------------------------------------------------------------------------
// The Imou Open API client against the fake cloud: the signature, the token
// and its renewal, the data centre redirect, the error codes the integration
// acts on, the paging of the device list. The AppSecret never travels.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ERROR_KINDS, ImouClient, REGIONS, apiHost, formatTime } from '../src/imou/client.js';
import { APP_ID, APP_SECRET, FakeCloud, HOST, KEYS } from './helpers/fakeCloud.js';

const responses = JSON.parse(
  readFileSync(new URL('./fixtures/imou/responses.json', import.meta.url), 'utf8'),
);

function client(cloud = new FakeCloud(), options = {}) {
  return new ImouClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    host: REGIONS.sg,
    transport: cloud.transport,
    ...options,
  });
}

/** A transport answering one fixture, recording the bodies sent. */
function replay(...names) {
  const sent = [];
  return {
    sent,
    post: async (url, body) => {
      sent.push({ url, body });
      const name = names.length > 1 ? names.shift() : names[0];
      return { status: 200, text: JSON.stringify(responses[name]) };
    },
    get: async () => ({ status: 404, bytes: Buffer.alloc(0) }),
  };
}

test('every call is signed with md5("time:…,nonce:…,appSecret:…"), the secret never sent', async () => {
  const transport = replay('accessToken_ok');
  await client(undefined, { transport }).fetchToken();
  const [{ url, body }] = transport.sent;
  assert.equal(url, `https://${REGIONS.sg}/openapi/accessToken`);
  const { ver, appId, time, nonce, sign } = body.system;
  assert.equal(ver, '1.0');
  assert.equal(appId, APP_ID);
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.equal(
    sign,
    createHash('md5').update(`time:${time},nonce:${nonce},appSecret:${APP_SECRET}`).digest('hex'),
  );
  assert.ok(!JSON.stringify(body).includes(APP_SECRET));
});

test('the token of the fixture is kept with its expiry and the data centre it names', async () => {
  const now = Date.UTC(2026, 9, 14);
  let saved = null;
  const imou = client(undefined, {
    transport: replay('accessToken_ok'),
    now: () => now,
    onToken: (token) => {
      saved = token;
    },
  });
  await imou.ensureToken();
  assert.equal(imou.host, 'openapi-fk.easy4ip.com');
  assert.deepEqual(saved, {
    token: 'At_0000fakefakefakefakefakefakefa',
    expiresAt: now + 190805 * 1000,
    host: 'openapi-fk.easy4ip.com',
  });
  assert.equal(imou.hasToken, true);
});

test('a saved token is reused: no new accessToken call', async () => {
  const cloud = new FakeCloud();
  const first = client(cloud);
  await first.listDevices();
  const second = client(cloud, { token: first.token });
  await second.listDevices();
  assert.equal(cloud.calls('accessToken').length, 1);
  assert.equal(second.host, HOST);
});

test('an expired token is renewed once, then the call goes through', async () => {
  const cloud = new FakeCloud();
  const imou = client(cloud, {
    token: { token: 'At_stale', expiresAt: Date.now() + 3_600_000, host: HOST },
  });
  const list = await imou.listDevices();
  assert.equal(list.length, cloud.devices.length);
  assert.deepEqual(
    cloud.requests.map((r) => r.method),
    ['listDeviceDetailsByPage', 'accessToken', 'listDeviceDetailsByPage'],
  );
});

test('a token refused right after its renewal is an authentication error', async () => {
  const transport = replay('accessToken_expired', 'accessToken_ok', 'accessToken_expired');
  const imou = client(undefined, {
    transport,
    token: { token: 'At_stale', expiresAt: Date.now() + 3_600_000, host: HOST },
  });
  await assert.rejects(imou.online(KEYS.PT), { kind: ERROR_KINDS.AUTH, code: 'TK1002' });
});

test('a wrong AppId or AppSecret is an authentication error', async () => {
  const wrongId = client(undefined, { transport: replay('accessToken_wrong_app_id') });
  await assert.rejects(wrongId.listDevices(), { kind: ERROR_KINDS.AUTH, code: 'OP1008' });
  const cloud = new FakeCloud();
  const wrongSecret = client(cloud, { appSecret: 'not the secret' });
  await assert.rejects(wrongSecret.listDevices(), { kind: ERROR_KINDS.AUTH, code: 'SN1001' });
});

test('quota, licences, offline, no SD card: their own error kinds', async () => {
  const cloud = new FakeCloud();
  const imou = client(cloud);
  await assert.rejects(imou.storage(KEYS.DUAL), { kind: ERROR_KINDS.NO_STORAGE });
  cloud.setStatus(KEYS.OFFLINE, 'offline');
  await assert.rejects(imou.snapshot(KEYS.OFFLINE, '0'), { kind: ERROR_KINDS.OFFLINE });
  cloud.unlicensed.add(KEYS.PT);
  await assert.rejects(imou.online(KEYS.PT), { kind: ERROR_KINDS.LICENSE, code: 'FL1001' });
  cloud.quotaUsed = true;
  await assert.rejects(imou.listDevices(), { kind: ERROR_KINDS.QUOTA, code: 'OP1013' });
});

test('network failures and server errors are "unreachable"', async () => {
  const cloud = new FakeCloud();
  cloud.reachable = false;
  await assert.rejects(client(cloud).listDevices(), { kind: ERROR_KINDS.UNREACHABLE });
  const down = {
    post: async () => ({ status: 502, text: 'Bad gateway' }),
    get: async () => ({ status: 502, bytes: Buffer.alloc(0) }),
  };
  await assert.rejects(client(undefined, { transport: down }).listDevices(), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
  const html = { post: async () => ({ status: 200, text: '<html>' }), get: down.get };
  await assert.rejects(client(undefined, { transport: html }).listDevices(), {
    kind: ERROR_KINDS.API,
  });
});

test('the device list is read page by page until a short page', async () => {
  const cloud = new FakeCloud();
  const template = cloud.devices[0];
  cloud.devices = Array.from({ length: 120 }, (_, i) => ({
    ...structuredClone(template),
    deviceId: `FAKEPAGE${String(i).padStart(4, '0')}`,
  }));
  const list = await client(cloud).listDevices();
  assert.equal(list.length, 120);
  assert.deepEqual(
    cloud.calls('listDeviceDetailsByPage').map((r) => r.params),
    [
      { page: 1, pageSize: 50 },
      { page: 2, pageSize: 50 },
      { page: 3, pageSize: 50 },
    ],
  );
});

test('the commands send what the libraries send', async () => {
  const cloud = new FakeCloud();
  const imou = client(cloud);
  await imou.move(KEYS.PT, '0', 2, 600);
  assert.deepEqual(cloud.moves, [
    { deviceId: KEYS.PT, channelId: '0', operation: '2', duration: '600' },
  ]);
  await imou.setSwitch(KEYS.FLOODLIGHT, '0', 'whiteLight', true);
  assert.equal(cloud.getSwitch(KEYS.FLOODLIGHT, '0', 'whiteLight'), true);
  await imou.setMotionDetection(KEYS.PT, '0', false);
  assert.equal(cloud.getSwitch(KEYS.PT, '0', 'motionDetect'), false);
  const url = await imou.snapshot(KEYS.PT, '0');
  assert.ok((await imou.download(url)).length > 0);
});

test('only Imou hosts are accepted as a data centre', () => {
  assert.equal(apiHost('https://openapi-fk.easy4ip.com:443'), 'openapi-fk.easy4ip.com');
  assert.equal(apiHost('openapi-sg.easy4ip.com'), 'openapi-sg.easy4ip.com');
  assert.equal(apiHost('https://openapi.lechange.cn'), 'openapi.lechange.cn');
  assert.equal(apiHost('https://openapi.imoulife.com:443'), 'openapi.imoulife.com');
  assert.equal(apiHost('https://evil.example.com'), null);
  assert.equal(apiHost('https://easy4ip.com.evil.example'), null);
  assert.equal(apiHost(''), null);
  assert.equal(apiHost(undefined), null);
});

test('a foreign currentDomain is ignored: the token stays on the configured host', async () => {
  const transport = {
    post: async () => ({
      status: 200,
      text: JSON.stringify({
        result: {
          code: '0',
          msg: 'ok',
          data: { accessToken: 'At_x', expireTime: 100, currentDomain: 'https://evil.example' },
        },
      }),
    }),
  };
  const imou = client(undefined, { transport });
  await imou.ensureToken();
  assert.equal(imou.host, REGIONS.sg);
});

test('the alarm window is written as Imou expects it', () => {
  assert.match(formatTime(Date.UTC(2026, 0, 2, 3, 4, 5)), /^2026-01-0\d \d\d:04:05$/);
});
