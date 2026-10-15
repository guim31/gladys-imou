// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/imou: the abilities of a real IPC-C22C from the
// imouapi tests, and the device list as pyimouapi reads it): a pan/tilt
// camera in privacy mode with an SD card, a floodlight camera with siren, a
// battery camera asleep, a doorbell, a camera offline, the two channels of a
// dual-lens camera and a camera of the newer Imou platform — after alarms, a
// ring and commands, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-ezviz.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BASE_CONFIG, KEYS, createAll, createWorld, discovered, feature } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: { ...BASE_CONFIG, language: scenario.language } });
    try {
      await createAll(world);
      // Alarms, a ring and commands, so the pulsed and commanded values exist too.
      world.cloud.addAlarm(KEYS.PT, { at: world.clock.now(), msgType: 'human' });
      world.cloud.addAlarm(KEYS.DOORBELL, { at: world.clock.now(), msgType: 'callEvent' });
      world.cloud.addAlarm(KEYS.BATTERY, { at: world.clock.now(), msgType: 'alarmPIR' });
      world.cloud.addAlarm(KEYS.DUAL, { at: world.clock.now(), channelId: '1' });
      await world.hub.checkAlarms();
      const floodlight = discovered(world, KEYS.FLOODLIGHT);
      for (const key of ['light', 'siren']) {
        await world.fake.setValue(floodlight, feature(floodlight, key), 1);
      }
      const pt = discovered(world, KEYS.PT);
      await world.fake.setValue(pt, feature(pt, 'move'), 2);

      const devices = world.fake.discoveredDevices;
      // 8 cameras: the gateway accessory is not one.
      assert.equal(devices.length, 8);
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          assert.equal(typeof feature.keep_history, 'boolean', `${at}: keep_history`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} for ${feature.category}`,
              );
            }
          }
          for (const option of feature.supported_options ?? []) {
            assert.ok(option.label && option.value !== undefined, `${at}: option without label`);
          }

          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // Every value published fits the declared bounds; images have none.
          if (feature.category === 'camera') {
            continue;
          }
          for (const state of world.fake.states.filter(
            (entry) => entry.device_feature_external_id === feature.external_id,
          )) {
            if (feature.category === 'text') {
              assert.equal(typeof state.text, 'string', `${at}: a text feature receives { text }`);
              assert.ok(state.text.length > 0, `${at}: empty text (Gladys ignores it)`);
              if (feature.type === 'select') {
                assert.ok(
                  feature.supported_options.some((option) => option.value === state.text),
                  `${at}: ${state.text} is not an option`,
                );
              }
              continue;
            }
            const value = state.state;
            assert.equal(typeof value, 'number', `${at}: non-numeric state`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (
              feature.type === 'integer' ||
              feature.type === 'binary' ||
              feature.type === 'ring'
            ) {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}

test('every feature that has a value received one once the devices are added', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const published = new Set(world.fake.states.map((state) => state.device_feature_external_id));
    const offline = discovered(world, KEYS.OFFLINE).external_id;
    const missing = world.fake.discoveredDevices
      .flatMap((device) => device.features)
      .filter((f) => f.category !== 'camera' && !published.has(f.external_id))
      // No alarm yet on these cameras: no last event to show.
      .filter((f) => !f.external_id.endsWith(':last_event'))
      // A camera offline cannot be read: only its online state.
      .filter((f) => !f.external_id.startsWith(`${offline}:`) || f.external_id.endsWith(':online'))
      .map((f) => f.external_id);
    assert.deepEqual(missing, []);
  } finally {
    await world.app.stop();
  }
});

test('the discovered devices are the cameras of the fixture, named by Imou', async () => {
  const world = await createWorld();
  try {
    assert.deepEqual(
      world.fake.discoveredDevices.map((device) => [device.name, device.model, device.should_poll]),
      [
        ['Salon', 'Imou IPC-A22EP', false],
        ['Allée', 'Imou IPC-F42FEP', false],
        ['Jardin', 'Imou IPC-B46LP', false],
        ['Entrée', 'Imou DB61i', false],
        ['Garage', 'Imou IPC-C22C', false],
        ['Rue', 'Imou IPC-S7XP-10M0WED', false],
        ['Cruiser Dual 2', 'Imou IPC-S7XP-10M0WED', false],
        ['Cour', 'Imou IPC-K7FP', false],
      ],
    );
  } finally {
    await world.app.stop();
  }
});
