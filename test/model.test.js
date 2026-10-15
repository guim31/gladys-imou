// -----------------------------------------------------------------------------
// What the integration reads in the Imou answers: the device list (one camera
// per channel, abilities, no accessory), the alarms of the imouapi tests and
// their kinds, battery, SD card, switches, online state.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALARM_KINDS,
  SD_STATES,
  alarmKind,
  parseAlarm,
  parseBattery,
  parseDeviceList,
  parseOnline,
  parseSdState,
  parseStatus,
  parseStorage,
  parseSwitch,
} from '../src/imou/model.js';
import { KEYS } from './helpers/fakeCloud.js';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/imou/${name}`, import.meta.url), 'utf8'));
const responses = read('responses.json');
const devices = read('devices.json').result.data.deviceList;
const data = (name) => responses[name].result.data;

test('one camera per channel; an accessory without channel is not a camera', () => {
  const cameras = parseDeviceList(devices);
  assert.deepEqual(
    cameras.map((camera) => camera.key),
    [
      KEYS.PT,
      KEYS.FLOODLIGHT,
      KEYS.BATTERY,
      KEYS.DOORBELL,
      KEYS.OFFLINE,
      KEYS.DUAL_0,
      KEYS.DUAL_1,
      KEYS.IOT,
    ],
  );
  const dual = cameras.filter((camera) => camera.deviceId === KEYS.DUAL);
  assert.deepEqual(
    dual.map((camera) => [camera.channelId, camera.name]),
    [
      ['0', 'Rue'],
      ['1', 'Cruiser Dual 2'],
    ],
  );
});

test('the abilities say what each camera has', () => {
  const byKey = new Map(parseDeviceList(devices).map((camera) => [camera.key, camera]));
  const pt = byKey.get(KEYS.PT);
  assert.equal(pt.ptz, 'pt');
  assert.equal(pt.privacyCapable, true);
  assert.equal(pt.detectionCapable, true);
  assert.equal(pt.personCapable, true);
  assert.equal(pt.sirenCapable, false);
  assert.equal(pt.sdCapable, true);
  const floodlight = byKey.get(KEYS.FLOODLIGHT);
  assert.equal(floodlight.lightCapable, true);
  assert.equal(floodlight.sirenCapable, true);
  assert.equal(floodlight.ptz, null);
  const battery = byKey.get(KEYS.BATTERY);
  assert.equal(battery.batteryPowered, true);
  assert.equal(battery.dormant, true);
  assert.equal(battery.status, 'sleep');
  assert.equal(battery.detectionCapable, false);
  assert.equal(byKey.get(KEYS.DOORBELL).doorbell, true);
  assert.equal(byKey.get(KEYS.OFFLINE).status, 'offline');
  assert.equal(byKey.get(KEYS.DUAL_0).ptz, 'ptz');
  assert.equal(byKey.get(KEYS.IOT).iot, true);
});

test('the online states of the API', () => {
  assert.equal(parseOnline(data('deviceOnline_ok'), '0'), 'online');
  assert.equal(parseOnline({ onLine: '0', channels: [] }, '0'), 'offline');
  assert.equal(
    parseOnline({ onLine: '1', channels: [{ channelId: 0, onLine: '4' }] }, '0'),
    'sleep',
  );
  assert.equal(parseStatus('3'), 'upgrading');
  assert.equal(parseStatus('online'), 'online');
  assert.equal(parseStatus(undefined), 'offline');
});

test('switch, battery, SD card and storage of the imouapi fixtures', () => {
  assert.equal(parseSwitch(data('getDeviceCameraStatus_ok')), true);
  assert.equal(parseSwitch({ status: 'off' }), false);
  assert.equal(parseSwitch({}), null);
  assert.equal(parseBattery(data('getDevicePowerInfo_ok')), 90);
  assert.equal(parseBattery({ electricitys: [{ electric: '42' }] }), 42);
  assert.equal(parseBattery({ electricitys: [] }), null);
  assert.equal(parseSdState(data('deviceSdcardStatus_ok')), SD_STATES.NORMAL);
  assert.equal(parseSdState({ status: 'empty' }), SD_STATES.NONE);
  assert.equal(parseSdState({ status: 'abnormal' }), SD_STATES.ERROR);
  assert.deepEqual(parseStorage(data('deviceStorage_ok')), { capacityGb: 29.1, freeGb: 3.4 });
  assert.equal(parseStorage({ totalBytes: 0 }), null);
});

test('the alarms of the imouapi fixture: two person detections', () => {
  const alarms = read('alarms.json').result.data.alarms.map(parseAlarm);
  assert.deepEqual(alarms[0], {
    id: '1623428357863536',
    at: 1664127393000,
    kind: ALARM_KINDS.PERSON,
    msgType: 'human',
    code: '120',
    picture: 'https://pictures.imou.test/pic/1623428357863536.jpg',
  });
  assert.equal(alarms[1].at, 1664021890000);
  assert.equal(parseAlarm({ alarmId: '1' }), null);
  assert.equal(parseAlarm({ time: 1 }), null);
});

test('the alarm kinds of the Imou message types', () => {
  assert.equal(alarmKind('videoMotion'), ALARM_KINDS.MOTION);
  assert.equal(alarmKind('e_alarmPIR'), ALARM_KINDS.MOTION);
  assert.equal(alarmKind('human'), ALARM_KINDS.PERSON);
  assert.equal(alarmKind('AiHuman'), ALARM_KINDS.PERSON);
  assert.equal(alarmKind('callEvent'), ALARM_KINDS.DOORBELL);
  assert.equal(alarmKind('e_CallBellEvent'), ALARM_KINDS.DOORBELL);
  assert.equal(alarmKind('abAlarmSound'), ALARM_KINDS.OTHER);
  assert.equal(alarmKind(undefined), ALARM_KINDS.OTHER);
});
