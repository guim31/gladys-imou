// -----------------------------------------------------------------------------
// An in-memory Imou Open API behind the transport seam of src/imou/http.js:
// signed requests (a wrong AppSecret is refused like Imou does, SN1001), the
// access token and its expiry, the data centre redirect, the device list of
// test/fixtures/imou, the alarm messages, switches, battery, SD card, PTZ,
// siren, captures and their download, the quota and the device licences.
// Every request is recorded (method, params without the token).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';

export const APP_ID = 'lcfake0app0id00';
export const APP_SECRET = 'fake-app-secret-0123456789abcdef';
export const HOST = 'openapi-fk.easy4ip.com';

export const KEYS = Object.freeze({
  PT: 'FAKE0IMOU0PT001',
  FLOODLIGHT: 'FAKE0IMOU0FL002',
  BATTERY: 'FAKE0IMOU0BT003',
  DOORBELL: 'FAKE0IMOU0DB004',
  OFFLINE: 'FAKE0IMOU0OF005',
  DUAL: 'FAKE0IMOU0DL006',
  DUAL_0: 'FAKE0IMOU0DL006-ch0',
  DUAL_1: 'FAKE0IMOU0DL006-ch1',
  IOT: 'FAKE0IMOU0IT007',
});

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/imou/${name}`, import.meta.url), 'utf8'));

export const JPEG = readFileSync(new URL('../fixtures/jpeg/420-restart.jpg', import.meta.url));

/** A small plain JPEG, written by jpeg-js. */
export function smallJpeg(width = 64, height = 36, shade = 120) {
  const data = Buffer.alloc(width * height * 4, shade);
  return Buffer.from(jpeg.encode({ width, height, data }, 80).data);
}

const md5 = (value) => createHash('md5').update(value).digest('hex');
const answer = (result) => ({ status: 200, text: JSON.stringify({ id: 'fake', result }) });
const ok = (data) =>
  answer({ code: '0', msg: 'Operation is successful.', ...(data ? { data } : {}) });
const refuse = (code, msg = 'refused') => answer({ code, msg });

export class FakeCloud {
  constructor() {
    this.appId = APP_ID;
    this.appSecret = APP_SECRET;
    this.reachable = true;
    this.devices = fixture('devices.json').result.data.deviceList;
    this.tokens = new Set();
    this.tokenLife = 190805; // seconds, as in the fixture
    this.counter = 0;
    this.requests = [];
    this.alarmsByKey = new Map();
    // Switches by "deviceId:channelId:enableType".
    this.switches = new Map();
    this.setSwitch(KEYS.PT, '0', 'closeCamera', true);
    this.setSwitch(KEYS.PT, '0', 'motionDetect', true);
    this.setSwitch(KEYS.FLOODLIGHT, '0', 'closeCamera', false);
    this.setSwitch(KEYS.FLOODLIGHT, '0', 'motionDetect', true);
    this.setSwitch(KEYS.FLOODLIGHT, '0', 'whiteLight', false);
    this.setSwitch(KEYS.DOORBELL, '0', 'motionDetect', true);
    this.setSwitch(KEYS.DUAL, '0', 'motionDetect', true);
    this.setSwitch(KEYS.DUAL, '1', 'motionDetect', false);
    this.setSwitch(KEYS.DUAL, '0', 'whiteLight', false);
    this.setSwitch(KEYS.DUAL, '1', 'whiteLight', false);
    this.battery = new Map([[KEYS.BATTERY, '76']]);
    this.sd = new Map([
      [KEYS.PT, { status: 'normal', totalBytes: 31254904832, usedBytes: 27553759232 }],
      [KEYS.FLOODLIGHT, { status: 'normal', totalBytes: 62509809664, usedBytes: 1073741824 }],
      [KEYS.DOORBELL, { status: 'empty' }],
      [KEYS.DUAL, { noCard: true }],
    ]);
    this.pictures = new Map();
    this.pictureStatus = 200;
    this.quotaUsed = false;
    this.unlicensed = new Set();
    this.moves = [];
    this.sirens = [];
    this.transport = { post: this.post.bind(this), get: this.get.bind(this) };
  }

  setSwitch(deviceId, channelId, enableType, on) {
    this.switches.set(`${deviceId}:${channelId}:${enableType}`, on);
  }

  getSwitch(deviceId, channelId, enableType) {
    return this.switches.get(`${deviceId}:${channelId}:${enableType}`);
  }

  device(deviceId) {
    return this.devices.find((device) => device.deviceId === deviceId);
  }

  /** Set the status of a device (and its channels): online, offline, sleep. */
  setStatus(deviceId, status) {
    const device = this.device(deviceId);
    device.deviceStatus = status;
    for (const channel of device.channelList ?? []) {
      channel.channelStatus = status;
    }
  }

  /**
   * A new alarm on a camera (listed first, newest first).
   * @param {string} deviceId
   * @param {object} [options] at (ms), msgType, channelId, picture (bytes|null|'encrypted')
   */
  addAlarm(deviceId, { at = Date.now(), msgType = 'videoMotion', channelId = '0', picture } = {}) {
    this.counter += 1;
    const alarmId = `${1700000000000000 + this.counter}`;
    const url = `https://pictures.imou.test/pic/${alarmId}.jpg?Signature=fake`;
    if (picture !== null) {
      this.pictures.set(
        url,
        picture === 'encrypted' ? Buffer.from('not a jpeg, encrypted bytes') : (picture ?? JPEG),
      );
    }
    const key = `${deviceId}:${channelId}`;
    const list = this.alarmsByKey.get(key) ?? [];
    list.unshift({
      msgType,
      alarmId,
      name: `${deviceId}-${Number(channelId) + 1}`,
      time: Math.floor(at / 1000),
      localDate: '2026-10-14 12:00:00',
      type: '120',
      thumbUrl: url,
      deviceId,
      picurlArray: picture === null ? [] : [url],
      channelId,
      token: `fake-${alarmId}_big`,
    });
    this.alarmsByKey.set(key, list);
    return alarmId;
  }

  calls(method) {
    return this.requests.filter((request) => request.method === method);
  }

  async post(url, body) {
    if (!this.reachable) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const { hostname, pathname } = new URL(url);
    const method = pathname.replace(/^\/openapi\//, '');
    const { token, ...params } = body.params ?? {};
    this.requests.push({ host: hostname, method, params });
    const system = body.system ?? {};
    if (system.appId !== this.appId) {
      return refuse('OP1008', 'app ID id null.');
    }
    if (
      system.sign !== md5(`time:${system.time},nonce:${system.nonce},appSecret:${this.appSecret}`)
    ) {
      return refuse('SN1001', 'Invalid signature.');
    }
    if (method === 'accessToken') {
      this.counter += 1;
      const issued = `At_fake${String(this.counter).padStart(26, '0')}`;
      this.tokens.add(issued);
      return ok({
        expireTime: this.tokenLife,
        currentDomain: `https://${HOST}:443`,
        accessToken: issued,
      });
    }
    if (!this.tokens.has(token)) {
      return refuse('TK1002', 'Token expired or does not exist, please get token again.');
    }
    if (this.quotaUsed) {
      return refuse('OP1013', 'The number of calls has been used up.');
    }
    if (params.deviceId && this.unlicensed.has(params.deviceId)) {
      return refuse('FL1001', 'Insufficient remaining available licenses.');
    }
    const handler = this[`on_${method}`];
    if (!handler) {
      return refuse('OP1002', `unknown method ${method}`);
    }
    return handler.call(this, params);
  }

  async get(url) {
    if (!this.reachable) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    this.requests.push({ download: true });
    const bytes = this.pictures.get(url);
    if (!bytes || this.pictureStatus !== 200) {
      return { status: bytes ? this.pictureStatus : 404, bytes: Buffer.alloc(0) };
    }
    return { status: 200, bytes };
  }

  // --- Methods of the Open API --------------------------------------------------

  on_listDeviceDetailsByPage({ page, pageSize }) {
    const start = (page - 1) * pageSize;
    const deviceList = structuredClone(this.devices.slice(start, start + pageSize));
    return ok({ count: deviceList.length, deviceList });
  }

  on_getDeviceCameraStatus({ deviceId, channelId, enableType }) {
    const value = this.getSwitch(deviceId, channelId, enableType);
    if (value === undefined) {
      return refuse('OP1015', 'The device does not support this capability.');
    }
    return ok({ enableType, status: value ? 'on' : 'off' });
  }

  on_setDeviceCameraStatus({ deviceId, channelId, enableType, enable }) {
    if (this.getSwitch(deviceId, channelId, enableType) === undefined) {
      return refuse('OP1015', 'The device does not support this capability.');
    }
    this.setSwitch(deviceId, channelId, enableType, enable === true);
    return ok();
  }

  on_modifyDeviceAlarmStatus({ deviceId, channelId, enable }) {
    this.setSwitch(deviceId, channelId, 'motionDetect', enable === true);
    return ok();
  }

  on_getAlarmMessage({ deviceId, channelId, count }) {
    const list = this.alarmsByKey.get(`${deviceId}:${channelId}`) ?? [];
    return ok({ alarms: structuredClone(list.slice(0, Number(count))), count: list.length });
  }

  on_getDevicePowerInfo({ deviceId }) {
    const level = this.battery.get(deviceId);
    if (level === undefined) {
      return refuse('OP1015', 'The device does not support this capability.');
    }
    return ok({ electricitys: [{ litElec: level, electric: level, type: 'battery' }] });
  }

  on_deviceSdcardStatus({ deviceId }) {
    const sd = this.sd.get(deviceId);
    if (!sd || sd.noCard) {
      return refuse('DV1049', 'No storage medium.');
    }
    return ok({ status: sd.status });
  }

  on_deviceStorage({ deviceId }) {
    const sd = this.sd.get(deviceId);
    if (!sd || sd.noCard) {
      return refuse('DV1049', 'No storage medium.');
    }
    return ok({ totalBytes: sd.totalBytes, usedBytes: sd.usedBytes });
  }

  on_setDeviceSnapEnhanced({ deviceId, channelId }) {
    const device = this.device(deviceId);
    if (device?.deviceStatus === 'offline') {
      return refuse('DV1007', 'The device is offline.');
    }
    this.counter += 1;
    const url = `https://pictures.imou.test/snap/${deviceId}/${channelId}/${this.counter}.jpg?Signature=fake`;
    this.pictures.set(url, JPEG);
    return ok({ url });
  }

  on_controlMovePTZ(params) {
    this.moves.push(params);
    return ok();
  }

  on_sirenStart({ deviceId }) {
    this.sirens.push({ deviceId, on: true });
    return ok();
  }

  on_sirenStop({ deviceId }) {
    this.sirens.push({ deviceId, on: false });
    return ok();
  }
}
