// -----------------------------------------------------------------------------
// The `imou` dashboard widget: valid content within the core budget, images it
// can serve, the privacy buttons and their safety gate, the toasts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { BASE_CONFIG, KEYS, cameraIds, createAll, createWorld } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

const buttons = (c) => c.components.filter((component) => component.type === 'button');

test('every content is valid, in every language, for every choice of cameras', async (t) => {
  const w = await world(t);
  w.cloud.addAlarm(KEYS.FLOODLIGHT, { at: w.clock.now(), msgType: 'human' });
  await w.hub.checkAlarms();
  const choices = [
    {},
    ...w.fake.discoveredDevices.map((device) => ({ cameras: [device.external_id] })),
  ];
  for (const settings of choices) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const c = await content(w, settings, language);
      assert.deepEqual(validateWidgetContent(c), [], JSON.stringify(settings));
      for (const image of c.components.filter((component) => component.type === 'image')) {
        const ack = await w.fake.widgetGetImage(image.key);
        assert.equal(ack.success, true);
        assert.deepEqual(validateWidgetImage(ack.data.image), []);
      }
    }
  }
});

test('all cameras: the newest image, one row per camera, no button', async (t) => {
  const w = await world(t);
  w.cloud.addAlarm(KEYS.PT, { at: w.clock.now(), msgType: 'human' });
  await w.hub.checkAlarms();
  const c = await content(w);
  assert.equal(c.components[0].type, 'image');
  const status = c.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 8);
  assert.deepEqual(status.items[0], {
    label: 'Salon',
    icon: 'eye-off',
    value: 'Privacy mode',
    color: 'neutral',
  });
  assert.deepEqual(buttons(c), []);
});

test('one private camera: "Resume watching" uncovers it, always allowed', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_disarm: false } });
  const id = cameraIds(w.gladys, KEYS.PT).device;
  const [resume] = buttons(await content(w, { cameras: [id] }));
  assert.equal(resume.action.key, 'privacy_off');
  const ack = await w.fake.widgetAction(WIDGET_KEY, resume.action.key, resume.action.params, {
    settings: { cameras: [id] },
  });
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, 'Salon: surveillance resumed');
  assert.equal(w.cloud.getSwitch(KEYS.PT, '0', 'closeCamera'), false);
  // Back to watching: a new image, and no privacy button while not allowed.
  assert.deepEqual(
    buttons(await content(w, { cameras: [id] })).map((button) => button.action.key),
    ['refresh'],
  );
});

test('privacy mode from the widget only when allowed, and after a confirmation', async (t) => {
  const w = await world(t);
  const id = cameraIds(w.gladys, KEYS.PT).device;
  w.cloud.setSwitch(KEYS.PT, '0', 'closeCamera', false);
  await w.hub.refresh({ switches: true });
  const c = await content(w, { cameras: [id] });
  const keys = buttons(c).map((button) => button.action.key);
  assert.deepEqual(keys, ['refresh', 'privacy_on']);
  const cover = buttons(c)[1];
  assert.equal(cover.action.confirm, true);
  const ack = await w.fake.widgetAction(WIDGET_KEY, cover.action.key, cover.action.params, {
    settings: { cameras: [id] },
  });
  assert.equal(ack.data.message.fr, 'Salon: mode privé activé');
  assert.equal(w.cloud.getSwitch(KEYS.PT, '0', 'closeCamera'), true);
  // A forged tap without the permission is refused by the hub too.
  const safe = await world(t, { config: { ...BASE_CONFIG, allow_disarm: false } });
  const refused = await safe.fake.widgetAction(
    WIDGET_KEY,
    'privacy_on',
    { camera: cameraIds(safe.gladys, KEYS.PT).device, privacy: true },
    { settings: {} },
  );
  assert.equal(refused.success, false);
  assert.match(refused.error, /Allow turning surveillance off/);
});

test('"New image" takes a capture and shows it', async (t) => {
  const w = await world(t);
  const id = cameraIds(w.gladys, KEYS.DOORBELL).device;
  const [refresh] = buttons(await content(w, { cameras: [id] }));
  const before = w.cloud.calls('setDeviceSnapEnhanced').length;
  w.clock.advance(60_000);
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'refresh', refresh.action.params, {
    settings: { cameras: [id] },
  });
  assert.equal(ack.data.message.de, 'Entrée: neues Bild');
  assert.equal(w.cloud.calls('setDeviceSnapEnhanced').length, before + 1);
  assert.equal((await content(w, { cameras: [id] })).components[0].type, 'image');
});

test('not configured, unknown camera, cloud refused: a plain message or a caption', async (t) => {
  const empty = await world(t, { config: { ...BASE_CONFIG, app_id: '' } });
  assert.match((await content(empty, {}, 'es')).components[0].text, /AppId/);
  const w = await world(t);
  assert.match((await content(w, { cameras: ['ext:gone'] })).components[0].text, /no longer/);
  w.cloud.quotaUsed = true;
  await w.hub.checkAlarms();
  const c = await content(w);
  assert.equal(c.components[0].type, 'text');
  assert.match(c.components[0].text, /quota/);
  assert.deepEqual(validateWidgetContent(c), []);
});
