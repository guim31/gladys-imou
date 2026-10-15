// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ALARM_INTERVALS,
  DEFAULT_CONFIG,
  LANGUAGES,
  REGION_KEYS,
  SNAPSHOT_INTERVALS,
} from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { DIRECTIONS, SCENE_ACTIONS, STATES } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { BASE_CONFIG, KEYS, cameraIds, createAll, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const options = (field) => field.options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, cloud transport, security category', () => {
  assert.equal(manifest.name, 'Imou Life');
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-imou:${pkg.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-imou/main/cover.png',
  );
  // The Imou Open API is a cloud: nothing on the local network.
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['security']);
  assert.equal(manifest.network_discovery, undefined);
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions), ['test_connection']);
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
});

test('no widget button opens a form: Gladys 5.1.0 is enough', async (t) => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  for (const key of [KEYS.PT, KEYS.FLOODLIGHT]) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, {
      settings: { cameras: [cameraIds(world.gladys, key).device] },
      language: 'en',
    });
    const buttons = ack.data.content.components.filter((c) => c.type === 'button');
    assert.ok(buttons.length > 0);
    assert.ok(buttons.every((button) => button.action.fields === undefined));
  }
});

test('every scene_actions key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const fields = {
    refresh_snapshot: { camera: cameraIds(world.gladys, KEYS.FLOODLIGHT).device },
    move_camera: { camera: cameraIds(world.gladys, KEYS.PT).device, direction: 'right' },
    set_privacy_mode: { camera: cameraIds(world.gladys, KEYS.PT).device, state: 'off' },
    set_motion_detection: { camera: cameraIds(world.gladys, KEYS.FLOODLIGHT).device, state: 'on' },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
});

test('the select options of the scene actions match the code', () => {
  const field = (action, key) =>
    manifest.scene_actions.find((a) => a.key === action).fields.find((f) => f.key === key);
  assert.deepEqual(options(field('move_camera', 'direction')), DIRECTIONS);
  assert.deepEqual(options(field('set_privacy_mode', 'state')), STATES);
  assert.deepEqual(options(field('set_motion_detection', 'state')), STATES);
  // Required fields carry a default: adding one later would break the scenes.
  for (const action of manifest.scene_actions) {
    for (const f of action.fields ?? []) {
      if (f.required && f.source === undefined) {
        assert.notEqual(f.default, undefined, `${action.key}.${f.key} has a default`);
      }
    }
  }
  // The default directions of the safety-relevant actions are the safe ones.
  assert.equal(field('set_privacy_mode', 'state').default, 'off');
  assert.equal(field('set_motion_detection', 'state').default, 'on');
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.cloud.addAlarm(KEYS.PT, { at: world.clock.now(), msgType: 'human' });
  world.cloud.addAlarm(KEYS.DOORBELL, { at: world.clock.now(), msgType: 'callEvent' });
  await world.hub.checkAlarms();
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    // Filters match keys of `data`, variables read keys of `data`.
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const key of Object.keys(data)) {
      assert.ok(
        keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
        `${trigger.key}: "${key}" is declared`,
      );
    }
  }
  const kinds = manifest.scene_triggers
    .find((trigger) => trigger.key === TRIGGERS.MOTION)
    .fields.find((field) => field.key === 'kind');
  assert.deepEqual(options(kinds), ['motion', 'person']);
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.deepEqual(options(field('language')), LANGUAGES);
  assert.deepEqual(options(field('region')), REGION_KEYS);
  assert.deepEqual(options(field('alarm_interval')), ALARM_INTERVALS);
  assert.deepEqual(options(field('snapshot_interval')), SNAPSHOT_INTERVALS);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  assert.equal(field('app_secret').type, 'secret', 'the AppSecret is a secret field');
  // The siren and turning surveillance off stay off unless the user ticks them.
  for (const key of ['allow_siren', 'allow_disarm']) {
    assert.equal(field(key).type, 'boolean');
    assert.equal(field(key).default, false);
  }
  // The test configuration ticks both: the safe defaults are tested apart.
  assert.equal(BASE_CONFIG.allow_disarm, true);
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('trigger fields hold no boolean, no secret (refused by the core)', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.notEqual(field.type, 'boolean');
      assert.notEqual(field.type, 'secret');
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
    assert.equal(typeof field.placeholder.en, 'string');
  }
});
