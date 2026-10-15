// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake Imou cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No periodic timer runs unless `timers: true`
// (with node:test mock timers): the tests read the cloud with
// `world.hub.refresh()` and `world.hub.checkAlarms()`.
// (Adapted from guim31/gladys-ezviz.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { APP_ID, APP_SECRET, FakeCloud, HOST, JPEG, KEYS } from './fakeCloud.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  app_id: APP_ID,
  app_secret: APP_SECRET,
  region: 'eu',
  alarm_interval: '60',
  snapshot_interval: '15',
  allow_disarm: true,
  allow_siren: true,
  language: 'en',
};

/** A manual clock. */
export function createClock(start = Date.UTC(2026, 9, 14, 12, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the handlers and the fake network settle. */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {FakeCloud} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 * @param {string} [options.dataDir] the /data of the container
 */
export async function createWorld({
  clock = createClock(),
  cloud = new FakeCloud(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-imou-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    transport: cloud.transport,
    // The conversion runs in a worker in production; the fixture JPEG fits.
    timers,
    timings: {
      motionMs: 50,
      ringMs: 50,
      sirenMs: 50,
      snapshotWaitMs: 1,
      eventImageWaitMs: 2000,
      ...timings,
    },
    now: clock.now,
  });
  const world = { gladys, fake: gladys.fake, cloud, app, hub: app.hub, clock, dataDir };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

/** External ids of a camera of the fixtures. */
export const cameraIds = (gladys, key = KEYS.PT) => gladys.externalIds('camera', key);

/**
 * Add every discovered device in Gladys, as the user would.
 * @param {object} world
 * @param {object} [options] flush: wait for the first captures (not with mocked timers)
 */
export async function createAll(world, { flush = true } = {}) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
  // The first captures of the new cameras wait a moment before their download:
  // let them finish, so a test's own capture is not shared with one of them.
  if (flush) {
    await world.hub.flushImages();
    await settle();
  }
}

/** The discovered device of a camera key. */
export function discovered(world, key) {
  return world.fake.discoveredDevices.find(
    (device) => device.external_id === cameraIds(world.gladys, key).device,
  );
}

/** A feature of a discovered device. */
export function feature(device, key) {
  return device.features.find((f) => f.external_id.endsWith(`:${key}`));
}

export { APP_ID, APP_SECRET, FakeCloud, HOST, JPEG, KEYS };
