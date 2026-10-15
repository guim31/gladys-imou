// -----------------------------------------------------------------------------
// The timers of the container. Gladys never polls a device published with
// should_poll: false (and never polls the devices created without should_poll,
// GladysAssistant/Gladys#3198): the cloud must be read by the hub's own
// timers, with no onPoll at all — the alarms at the interval of the
// configuration, the device list every 10 minutes, the switches every 30, the
// captures on their timer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import { BASE_CONFIG, KEYS, cameraIds, createAll, createWorld, settle } from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.UTC(2026, 9, 14, 12),
  });
  // The hub reads the mocked clock, which the ticks move.
  const clock = { now: () => Date.now() };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  // The captures of the new cameras wait a moment before their download.
  await tick(t, 10);
  return w;
}

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle(80);
  // Let the short waits started by this tick (capture downloads) run too.
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(5);
    await settle(40);
  }
}

const count = (w, method) => w.cloud.calls(method).length;

test('the alarms are read on the internal timer, without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  assert.ok(w.fake.discoveredDevices.every((device) => device.poll_frequency === undefined));
  const before = count(w, 'getAlarmMessage');
  w.cloud.addAlarm(KEYS.PT, { at: Date.now() + 1000, msgType: 'human' });
  await tick(t, 60_000);
  // One read per camera added and not offline (7 of the 8).
  assert.equal(count(w, 'getAlarmMessage') - before, 7);
  assert.equal(w.fake.sceneEvents.length, 2, 'the scene events, from the timer');
  const person = cameraIds(w.gladys, KEYS.PT).feature('person');
  assert.ok(w.fake.states.some((s) => s.device_feature_external_id === person && s.state === 1));
  await tick(t, 60_000);
  assert.equal(count(w, 'getAlarmMessage') - before, 14);
  // The test never calls fake.poll(): every read came from the timers.
});

test('the alarm interval of the configuration is followed', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, alarm_interval: '300' } });
  const before = count(w, 'getAlarmMessage');
  await tick(t, 4 * 60_000);
  assert.equal(count(w, 'getAlarmMessage'), before);
  await tick(t, 60_000);
  assert.equal(count(w, 'getAlarmMessage') - before, 7);
});

test('the device list every 10 minutes, the switches every 30: a change in the app shows up', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, alarm_interval: '600' } });
  const privacy = cameraIds(w.gladys, KEYS.PT).feature('privacy');
  const online = cameraIds(w.gladys, KEYS.FLOODLIGHT).feature('online');
  assert.equal(w.fake.lastState(privacy), 1);
  const lists = count(w, 'listDeviceDetailsByPage');
  w.cloud.setSwitch(KEYS.PT, '0', 'closeCamera', false);
  w.cloud.setStatus(KEYS.FLOODLIGHT, 'offline');
  await tick(t, HUB_TIMINGS.listMs);
  assert.equal(count(w, 'listDeviceDetailsByPage') - lists, 1);
  assert.equal(w.fake.lastState(online), 0, 'the online state comes with the list');
  assert.equal(w.fake.lastState(privacy), 1, 'the switches wait for their round');
  await tick(t, HUB_TIMINGS.listMs);
  await tick(t, HUB_TIMINGS.listMs);
  assert.equal(w.fake.lastState(privacy), 0);
});

test('captures follow the interval of the configuration: mains-powered cameras only', async (t) => {
  const w = await timedWorld(t);
  const before = count(w, 'setDeviceSnapEnhanced');
  await tick(t, 15 * 60_000);
  // Online, mains-powered, not private: floodlight, doorbell, both lenses, IoT.
  assert.deepEqual(
    w.cloud
      .calls('setDeviceSnapEnhanced')
      .slice(before)
      .map((r) => r.params.deviceId)
      .sort(),
    [KEYS.DOORBELL, KEYS.DUAL, KEYS.DUAL, KEYS.FLOODLIGHT, KEYS.IOT],
  );
});

test('no periodic capture when the configuration says "only on alarm"', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, snapshot_interval: '0' } });
  const before = count(w, 'setDeviceSnapEnhanced');
  await tick(t, 60 * 60_000);
  assert.equal(count(w, 'setDeviceSnapEnhanced'), before);
});

test('a heartbeat re-sends unchanged values within 12 hours', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, alarm_interval: '600' } });
  const battery = cameraIds(w.gladys, KEYS.BATTERY).feature('battery');
  const sent = () => w.fake.states.filter((s) => s.device_feature_external_id === battery).length;
  const before = sent();
  await tick(t, 7 * 60 * 60_000);
  assert.ok(sent() > before, 'the unchanged battery level was sent again');
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.cloud.requests.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.cloud.requests.length, requests);
});
