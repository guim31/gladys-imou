// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — device lists, alarm reads, alarms, pictures,
// captures — writes nothing; a failure that repeats is logged once, and its
// end once. Never the AppSecret, the AppId, a token nor a picture address —
// at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_ID,
  APP_SECRET,
  KEYS,
  createAll,
  createWorld,
  discovered,
  settle,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Every secret the logs must never hold, with the tokens the cloud gave. */
function secrets(w) {
  return [APP_SECRET, APP_ID, 'pictures.imou.test', 'Signature=', ...w.cloud.tokens];
}

function assertNoSecret(w, logs) {
  const text = logs.texts().join('\n');
  for (const secret of secrets(w)) {
    assert.ok(!text.includes(secret), `the logs hold "${secret}"`);
  }
}

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to the Imou Open API')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    w.cloud.addAlarm(KEYS.PT, { at: w.clock.now(), msgType: 'human' });
    w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), picture: 'encrypted' });
    w.cloud.addAlarm(KEYS.DOORBELL, { at: w.clock.now(), msgType: 'callEvent' });
    await w.hub.checkAlarms();
    w.clock.advance(10 * 60_000);
    await w.hub.refresh({ switches: true, sensors: true });
    await w.hub.snapshotAll();
    await w.fake.getImage(discovered(w, KEYS.FLOODLIGHT));
  }
  // The battery camera wakes up and sleeps again: not news either.
  w.cloud.setStatus(KEYS.BATTERY, 'online');
  await w.hub.refresh();
  w.cloud.setStatus(KEYS.BATTERY, 'sleep');
  await w.hub.refresh();
  await sleep(80); // the pulses end
  await settle();
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.cloud.reachable = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
    await w.hub.checkAlarms();
    await w.hub.snapshotAll();
  }
  const down = logs.texts().filter((text) => text.includes('Cannot read the Imou cloud'));
  assert.equal(down.length, 1);
  w.cloud.reachable = true;
  await w.hub.refresh();
  assert.equal(logs.texts().filter((text) => text.includes('answers again')).length, 1);
  assertNoSecret(w, logs);
});

test('a used-up quota and a refused secret: one line each', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.cloud.quotaUsed = true;
  for (let i = 0; i < 4; i += 1) {
    await w.hub.checkAlarms();
    await w.hub.refresh();
  }
  assert.equal(logs.texts().filter((text) => text.includes('quota')).length, 1);
  logs.clear();
  const refused = await world(t, { config: { ...w.fake.config, app_secret: 'wrong' } });
  for (let i = 0; i < 4; i += 1) {
    await refused.hub.refresh();
  }
  assert.equal(logs.texts().filter((text) => text.includes('refused the application')).length, 1);
  assertNoSecret(refused, logs);
});

test('a camera offline and back: two lines; a user command: one', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.cloud.setStatus(KEYS.FLOODLIGHT, 'offline');
  await w.hub.refresh();
  await w.hub.refresh();
  w.cloud.setStatus(KEYS.FLOODLIGHT, 'online');
  await w.hub.refresh();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Allée is offline', 'Allée is online again'],
  );
  logs.clear();
  const device = discovered(w, KEYS.FLOODLIGHT);
  await w.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(':light')),
    1,
  );
  assert.equal(logs.lines.length, 1);
  assert.match(logs.texts()[0], /Allée: floodlight on/);
});

test('debug writes the details, never a secret', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  w.cloud.addAlarm(KEYS.PT, { at: w.clock.now(), msgType: 'human' });
  w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), picture: 'encrypted' });
  await w.hub.checkAlarms();
  await w.hub.refresh({ switches: true, sensors: true });
  w.cloud.reachable = false;
  await w.hub.refresh();
  await w.hub.checkAlarms();
  w.cloud.reachable = true;
  w.cloud.quotaUsed = true;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.ok(logs.texts().some((text) => text.includes('[DEBUG]')));
  assertNoSecret(w, logs);
});
