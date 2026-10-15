// -----------------------------------------------------------------------------
// The hub against the fake Imou cloud and the SDK's fake Gladys: alarms and
// their pictures, scene events, states, commands and their safety gates, the
// quota, the device licences, the token kept in /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakeCloud,
  KEYS,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  feature,
  settle,
} from './helpers/world.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function created(t, options = {}) {
  const w = await world(t, options);
  await createAll(w);
  return w;
}

const state = (w, key, featureKey) =>
  w.fake.lastState(cameraIds(w.gladys, key).feature(featureKey));

test('nothing is read before the AppId and AppSecret are entered', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, app_id: '', app_secret: '' } });
  assert.equal(w.cloud.requests.length, 0);
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /AppId et l’AppSecret/);
});

test('only the cameras added to Gladys are read, one call each', async (t) => {
  const w = await world(t);
  // Before any camera is added: the token and the device list, nothing else.
  assert.deepEqual(
    w.cloud.requests.map((r) => r.method),
    ['accessToken', 'listDeviceDetailsByPage'],
  );
  await w.fake.deviceCreated(discovered(w, KEYS.PT));
  await settle();
  w.cloud.requests.length = 0;
  await w.hub.checkAlarms();
  assert.deepEqual(
    w.cloud.requests.map((r) => [r.method, r.params.deviceId]),
    [['getAlarmMessage', KEYS.PT]],
  );
});

test('a person: motion and person pulse, last event, picture first, then two triggers', async (t) => {
  const w = await created(t);
  const before = w.fake.cameraImages.length;
  w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), msgType: 'human' });
  await w.hub.checkAlarms();
  assert.equal(state(w, KEYS.FLOODLIGHT, 'motion'), 1);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'person'), 1);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'last_event'), 'Person · 12:00');
  const id = cameraIds(w.gladys, KEYS.FLOODLIGHT).device;
  assert.equal(w.fake.cameraImages.length, before + 1);
  assert.equal(w.fake.cameraImages.at(-1).device_external_id, id);
  assert.deepEqual(w.fake.sceneEvents, [
    { key: TRIGGERS.PERSON, data: { camera: id, camera_name: 'Allée' } },
    {
      key: TRIGGERS.MOTION,
      data: { camera: id, camera_name: 'Allée', kind: 'person', kind_name: 'Person' },
    },
  ]);
  // The same alarm read again fires nothing.
  await w.hub.checkAlarms();
  assert.equal(w.fake.sceneEvents.length, 2);
  await sleep(80);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'motion'), 0);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'person'), 0);
});

test('an encrypted alarm picture is replaced by a capture, never on a battery camera', async (t) => {
  const w = await created(t);
  const snaps = () => w.cloud.calls('setDeviceSnapEnhanced').length;
  let before = snaps();
  w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), picture: 'encrypted' });
  await w.hub.checkAlarms();
  assert.equal(snaps() - before, 1);
  before = snaps();
  w.cloud.setStatus(KEYS.BATTERY, 'online');
  await w.hub.refresh();
  w.cloud.addAlarm(KEYS.BATTERY, { at: w.clock.now(), msgType: 'alarmPIR', picture: 'encrypted' });
  await w.hub.checkAlarms();
  assert.equal(snaps(), before, 'the battery camera is not woken up');
  assert.equal(w.fake.sceneEvents.at(-1).data.camera, cameraIds(w.gladys, KEYS.BATTERY).device);
});

test('a plain alarm picture is used as is: no capture', async (t) => {
  const w = await created(t);
  const before = w.cloud.calls('setDeviceSnapEnhanced').length;
  w.cloud.addAlarm(KEYS.PT, { at: w.clock.now() });
  await w.hub.checkAlarms();
  assert.equal(w.cloud.calls('setDeviceSnapEnhanced').length, before);
  assert.equal(w.fake.cameraImages.at(-1).device_external_id, cameraIds(w.gladys, KEYS.PT).device);
});

test('alarms from before the start or listed late show, but fire nothing', async (t) => {
  const cloud = new FakeCloud();
  const start = Date.UTC(2026, 9, 14, 12);
  cloud.addAlarm(KEYS.PT, { at: start - 3_600_000, msgType: 'human' });
  const devices = [];
  const first = await createWorld({ cloud });
  await createAll(first);
  devices.push(...first.fake.discoveredDevices);
  await first.app.stop();
  // A restart, the devices already in Gladys.
  const w = await world(t, { cloud, devices });
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.match(state(w, KEYS.PT, 'last_event'), /^Person · 1[01]:00$/);
  cloud.addAlarm(KEYS.PT, { at: w.clock.now() - 20 * 60_000 });
  await w.hub.checkAlarms();
  assert.equal(w.fake.sceneEvents.length, 0);
});

test('an alarm right after a camera is added fires', async (t) => {
  const w = await world(t);
  await w.fake.deviceCreated(discovered(w, KEYS.PT));
  w.clock.advance(1000);
  w.cloud.addAlarm(KEYS.PT, { at: w.clock.now() });
  await w.hub.checkAlarms();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.MOTION],
  );
});

test('a ring pulses the doorbell and fires its trigger; a camera that rings learns it', async (t) => {
  const w = await created(t);
  w.cloud.addAlarm(KEYS.DOORBELL, { at: w.clock.now(), msgType: 'callEvent' });
  await w.hub.checkAlarms();
  assert.equal(state(w, KEYS.DOORBELL, 'ring'), 1);
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: TRIGGERS.DOORBELL,
    data: { doorbell: cameraIds(w.gladys, KEYS.DOORBELL).device, doorbell_name: 'Entrée' },
  });
  // A camera whose abilities did not say "doorbell" gets the feature, kept in /data.
  assert.equal(feature(discovered(w, KEYS.FLOODLIGHT), 'ring'), undefined);
  w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), msgType: 'callBellEvent' });
  await w.hub.checkAlarms();
  assert.ok(feature(discovered(w, KEYS.FLOODLIGHT), 'ring'));
  await w.hub.store.flush();
  const saved = JSON.parse(readFileSync(join(w.dataDir, 'imou-state.json'), 'utf8'));
  assert.deepEqual(saved.doorbells, [KEYS.FLOODLIGHT]);
});

test('switches, battery and SD card are published as read', async (t) => {
  const w = await created(t);
  assert.equal(state(w, KEYS.PT, 'privacy'), 1);
  assert.equal(state(w, KEYS.PT, 'detection'), 1);
  assert.equal(state(w, KEYS.PT, 'sd_state'), 'Normal');
  assert.equal(state(w, KEYS.PT, 'sd_capacity'), 29.1);
  assert.equal(state(w, KEYS.PT, 'sd_free'), 3.4);
  assert.equal(state(w, KEYS.DOORBELL, 'sd_state'), 'No card');
  assert.equal(state(w, KEYS.BATTERY, 'battery'), 76);
  assert.equal(state(w, KEYS.BATTERY, 'online'), 1, 'asleep is online');
  assert.equal(state(w, KEYS.OFFLINE, 'online'), 0);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'light'), 0);
  assert.deepEqual(
    w.fake.transports.find(
      (entry) => entry.device_external_id === cameraIds(w.gladys, KEYS.OFFLINE).device,
    )?.transport,
    'unreachable',
  );
});

test('floodlight and pan/tilt from Gladys', async (t) => {
  const w = await created(t);
  const floodlight = discovered(w, KEYS.FLOODLIGHT);
  assert.equal((await w.fake.setValue(floodlight, feature(floodlight, 'light'), 1)).success, true);
  assert.equal(w.cloud.getSwitch(KEYS.FLOODLIGHT, '0', 'whiteLight'), true);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'light'), 1);
  const pt = discovered(w, KEYS.PT);
  const move = feature(pt, 'move');
  assert.deepEqual(
    move.supported_options.map((option) => option.value),
    [1, 2, 3, 4],
  );
  await w.fake.setValue(pt, move, 3);
  await w.fake.setValue(pt, move, 0);
  assert.deepEqual(
    w.cloud.moves.map((m) => [m.operation, m.duration]),
    [
      ['0', '600'],
      ['10', '600'],
    ],
  );
  // Zoom on a camera without it: refused, nothing sent.
  const ack = await w.fake.setValue(pt, move, 5);
  assert.equal(ack.success, false);
  assert.equal(w.cloud.moves.length, 2);
});

test('the siren only when allowed; it goes back to 0 by itself', async (t) => {
  const w = await created(t);
  const floodlight = discovered(w, KEYS.FLOODLIGHT);
  await w.fake.setValue(floodlight, feature(floodlight, 'siren'), 1);
  assert.deepEqual(w.cloud.sirens, [{ deviceId: KEYS.FLOODLIGHT, on: true }]);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'siren'), 1);
  await sleep(80);
  assert.equal(state(w, KEYS.FLOODLIGHT, 'siren'), 0);

  const safe = await world(t, { config: { ...BASE_CONFIG, allow_siren: false } });
  await createAll(safe);
  const device = discovered(safe, KEYS.FLOODLIGHT);
  assert.equal(feature(device, 'siren'), undefined, 'no siren feature by default');
  const ack = await safe.fake.setValue(device, { external_id: `${device.external_id}:siren` }, 1);
  assert.equal(ack.success, false);
  assert.deepEqual(safe.cloud.sirens, []);
});

test('detection and privacy are read-only features: Gladys cannot switch them', async (t) => {
  const w = await created(t);
  const pt = discovered(w, KEYS.PT);
  for (const key of ['detection', 'privacy']) {
    assert.equal(feature(pt, key).read_only, true);
    const ack = await w.fake.setValue(pt, feature(pt, key), 0);
    assert.equal(ack.success, false);
  }
  assert.equal(w.cloud.getSwitch(KEYS.PT, '0', 'closeCamera'), true);
});

test('turning surveillance off needs the configuration; turning it on never does', async (t) => {
  const w = await created(t, { config: { ...BASE_CONFIG, allow_disarm: false } });
  const pt = cameraIds(w.gladys, KEYS.PT).device;
  const floodlight = cameraIds(w.gladys, KEYS.FLOODLIGHT).device;
  // Safe directions: uncover the lens, detection on.
  assert.equal(
    (await w.fake.sceneAction('set_privacy_mode', { camera: pt, state: 'off' })).success,
    true,
  );
  assert.equal(w.cloud.getSwitch(KEYS.PT, '0', 'closeCamera'), false);
  assert.equal(state(w, KEYS.PT, 'privacy'), 0);
  assert.equal(
    (await w.fake.sceneAction('set_motion_detection', { camera: floodlight, state: 'on' })).success,
    true,
  );
  // Disarming directions: refused, nothing sent.
  const cover = await w.fake.sceneAction('set_privacy_mode', { camera: pt, state: 'on' });
  assert.equal(cover.success, false);
  assert.match(cover.error, /Allow turning surveillance off/);
  const off = await w.fake.sceneAction('set_motion_detection', {
    camera: floodlight,
    state: 'off',
  });
  assert.equal(off.success, false);
  assert.equal(w.cloud.getSwitch(KEYS.PT, '0', 'closeCamera'), false);
  assert.equal(w.cloud.getSwitch(KEYS.FLOODLIGHT, '0', 'motionDetect'), true);

  const allowed = await created(t);
  const id = cameraIds(allowed.gladys, KEYS.FLOODLIGHT).device;
  await allowed.fake.sceneAction('set_motion_detection', { camera: id, state: 'off' });
  assert.equal(allowed.cloud.getSwitch(KEYS.FLOODLIGHT, '0', 'motionDetect'), false);
  assert.equal(state(allowed, KEYS.FLOODLIGHT, 'detection'), 0);
});

test('a command wins over a read made just after it (the cloud lags)', async (t) => {
  const w = await created(t);
  const pt = cameraIds(w.gladys, KEYS.PT).device;
  await w.fake.sceneAction('set_privacy_mode', { camera: pt, state: 'off' });
  // The cloud still answers the old value for a moment.
  w.cloud.setSwitch(KEYS.PT, '0', 'closeCamera', true);
  await w.hub.refresh({ switches: true });
  assert.equal(state(w, KEYS.PT, 'privacy'), 0);
  w.clock.advance(2 * 60_000);
  await w.hub.refresh({ switches: true });
  assert.equal(state(w, KEYS.PT, 'privacy'), 1);
});

test('a fresh image for Gladys: reused within 30 seconds, the last one when offline', async (t) => {
  const w = await created(t);
  const device = discovered(w, KEYS.FLOODLIGHT);
  const snaps = () => w.cloud.calls('setDeviceSnapEnhanced').length;
  w.clock.advance(60_000);
  const before = snaps();
  const first = await w.fake.getImage(device);
  assert.equal(first.success, true);
  assert.match(first.data.image, /^image\/jpg;base64,\/9j\//);
  await w.fake.getImage(device);
  assert.equal(snaps() - before, 1);
  w.cloud.setStatus(KEYS.FLOODLIGHT, 'offline');
  w.clock.advance(60_000);
  const last = await w.fake.getImage(device);
  assert.equal(last.data.image, first.data.image);
  const unknown = await w.fake.getImage({ external_id: 'ext:test-integration:camera:NOPE' });
  assert.equal(unknown.success, false);
});

test('a used-up quota pauses every read for an hour, said in the status', async (t) => {
  const w = await created(t);
  w.cloud.quotaUsed = true;
  await w.hub.checkAlarms();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /quota/);
  const calls = w.cloud.requests.length;
  await w.hub.checkAlarms();
  await w.hub.refresh();
  await w.hub.snapshotAll();
  assert.equal(w.cloud.requests.length, calls, 'no call while paused');
  w.cloud.quotaUsed = false;
  w.clock.advance(61 * 60_000);
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a camera beyond the free licences is skipped until the next list', async (t) => {
  const w = await created(t);
  w.cloud.unlicensed.add(KEYS.PT);
  await w.hub.checkAlarms();
  const calls = () => w.cloud.calls('getAlarmMessage').filter((r) => r.params.deviceId === KEYS.PT);
  const before = calls().length;
  await w.hub.checkAlarms();
  assert.equal(calls().length, before);
  w.cloud.unlicensed.clear();
  await w.hub.refresh();
  assert.ok(calls().length > before);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /Connected to the Imou Open API \(Europe\): 8 camera/);
});

test('a refused AppSecret stops the reads until the configuration changes', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, app_secret: 'wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused the AppId or the AppSecret/);
  const calls = w.cloud.requests.length;
  await w.hub.refresh();
  await w.hub.checkAlarms();
  assert.equal(w.cloud.requests.length, calls);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /refused the AppId/);
  await w.fake.configUpdated(BASE_CONFIG);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 8);
});

test('the token is kept in /data and reused after a restart; the secret is not', async (t) => {
  const cloud = new FakeCloud();
  const first = await createWorld({ cloud });
  const dataDir = first.dataDir;
  await first.app.stop();
  const file = readFileSync(join(dataDir, 'imou-state.json'), 'utf8');
  assert.ok(!file.includes(BASE_CONFIG.app_secret));
  assert.ok(!file.includes(BASE_CONFIG.app_id));
  assert.match(JSON.parse(file).token.token, /^At_fake/);
  await world(t, { cloud, dataDir });
  assert.equal(cloud.calls('accessToken').length, 1);
});

test('the Imou cloud down: unreachable cameras, said once, back when it answers', async (t) => {
  const w = await created(t);
  w.cloud.reachable = false;
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(w.fake.transports.some((entry) => entry.transport === 'unreachable'));
  w.cloud.reachable = true;
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('scene actions: capture, move, errors in the language of the configuration', async (t) => {
  const w = await created(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const dual = cameraIds(w.gladys, KEYS.DUAL_0).device;
  assert.equal(
    (await w.fake.sceneAction('move_camera', { camera: dual, direction: 'zoom_in' })).success,
    true,
  );
  assert.deepEqual(w.cloud.moves.at(-1), {
    deviceId: KEYS.DUAL,
    channelId: '0',
    operation: '8',
    duration: '600',
  });
  const flat = await w.fake.sceneAction('move_camera', {
    camera: cameraIds(w.gladys, KEYS.FLOODLIGHT).device,
    direction: 'up',
  });
  assert.match(flat.error, /ne peut pas tourner/);
  const unknown = await w.fake.sceneAction('refresh_snapshot', { camera: 'ext:nope' });
  assert.match(unknown.error, /n’est plus dans le compte Imou/);
  const offline = await w.fake.sceneAction('refresh_snapshot', {
    camera: cameraIds(w.gladys, KEYS.OFFLINE).device,
  });
  assert.match(offline.error, /Pas d’image/);
});

test('a reconnection of Gladys sends everything again', async (t) => {
  const w = await created(t);
  const states = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length > states, 'the states are sent again');
});
