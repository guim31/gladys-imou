// -----------------------------------------------------------------------------
// Client of the official Imou Open API (open.imoulife.com), as the Imou
// libraries do it (user2684/imouapi, Imou-OpenPlatform/pyimouapi, both MIT).
//
// Every call is a JSON POST to https://<host>/openapi/<method> with:
//   { system: { ver: "1.0", appId, time, nonce, sign }, params, id }
// where sign = md5("time:<time>,nonce:<nonce>,appSecret:<secret>"). The app
// secret itself never leaves the container. `accessToken` (no token) returns a
// token valid a few days (`expireTime`, in seconds) and `currentDomain`, the
// data centre of the account: the next calls go there. Every other call
// carries the token in `params.token`; an expired one (TK1002) is renewed once.
//
// An answer is { result: { code, msg, data } }, code "0" meaning success. The
// codes the integration acts on are mapped to error kinds (ERROR_KINDS).
// -----------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { httpTransport } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // network, timeout, 5xx
  AUTH: 'auth', // AppId or AppSecret refused
  QUOTA: 'quota', // the call quota of the developer account is used up
  LICENSE: 'license', // the free plan's device licences are used up
  NO_RIGHT: 'no_right', // the device is not (or no longer) on the account
  OFFLINE: 'offline', // the camera does not answer the cloud
  SLEEPING: 'sleeping', // a battery camera asleep
  NO_STORAGE: 'no_storage', // no SD card
  API: 'api', // anything else
});

// Result codes seen in the libraries and their tests.
const CODE_KINDS = {
  SN1001: ERROR_KINDS.AUTH, // invalid signature: wrong AppSecret
  SN1004: ERROR_KINDS.AUTH, // invalid application
  OP1008: ERROR_KINDS.AUTH, // AppId null or unknown
  OP1009: ERROR_KINDS.NO_RIGHT, // "No right, cannot operate"
  OP1013: ERROR_KINDS.QUOTA, // monthly call quota used up (Imou-Home-Assistant repairs.py)
  FL1001: ERROR_KINDS.LICENSE, // "Insufficient remaining available licenses"
  DV1007: ERROR_KINDS.OFFLINE,
  DV1030: ERROR_KINDS.SLEEPING,
  DV1049: ERROR_KINDS.NO_STORAGE,
};

// Token expired or unknown: fetch a new one and try again, once.
const TOKEN_CODES = new Set(['TK1001', 'TK1002']);

// Renew a token this long before Imou says it expires.
const TOKEN_MARGIN_MS = 10 * 60_000;

// The data centres of the Imou Open API (Imou-Home-Assistant const.py).
export const REGIONS = Object.freeze({
  eu: 'openapi-fk.easy4ip.com', // Frankfurt
  sg: 'openapi-sg.easy4ip.com', // Singapore
  na: 'openapi-or.easy4ip.com', // Oregon
  cn: 'openapi.lechange.cn', // Hangzhou, accounts of the Chinese platform
});

// The only hosts a token and a signature are ever sent to, `currentDomain`
// included.
const API_HOSTS = /(^|\.)(easy4ip\.com|lechange\.cn|imoulife\.com|imou\.com)$/;

// PTZ operations of controlMovePTZ.
export const PTZ_OPERATIONS = Object.freeze({
  up: 0,
  down: 1,
  left: 2,
  right: 3,
  zoom_in: 8,
  zoom_out: 9,
  stop: 10,
});

export class ImouError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {string} [code] the Imou result code
   */
  constructor(kind, message, code) {
    super(message);
    this.name = 'ImouError';
    this.kind = kind;
    this.code = code ?? null;
  }
}

/** The host name of a `currentDomain` ("https://openapi-fk.easy4ip.com:443"), null when foreign. */
export function apiHost(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  let host;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  return API_HOSTS.test(host) ? host : null;
}

/** The time of an alarm query, in the container's time zone (TZ, set by Gladys). */
export function formatTime(ms) {
  const date = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

export class ImouClient {
  /**
   * @param {object} options
   * @param {string} options.appId
   * @param {string} options.appSecret
   * @param {string} options.host data centre of the configuration (REGIONS)
   * @param {object} [options.token] saved token { token, expiresAt, host }
   * @param {(token: object|null) => void} [options.onToken] a new token to save
   * @param {object} [options.transport] { post, get } (src/imou/http.js)
   * @param {() => number} [options.now]
   */
  constructor({ appId, appSecret, host, token = null, onToken, transport, now }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.host = token?.host && apiHost(token.host) ? token.host : host;
    this.token = token?.token && token.expiresAt ? token : null;
    this.onToken = onToken ?? (() => {});
    this.transport = transport ?? httpTransport;
    this.now = now ?? (() => Date.now());
    this.tokenRequest = null;
    /** Calls sent since the start, for the reports and the probe. */
    this.calls = 0;
  }

  get hasToken() {
    return Boolean(this.token) && this.token.expiresAt - TOKEN_MARGIN_MS > this.now();
  }

  /** The signed envelope of a call. */
  envelope(params) {
    const time = Math.round(this.now() / 1000);
    const nonce = randomBytes(16).toString('hex');
    const sign = createHash('md5')
      .update(`time:${time},nonce:${nonce},appSecret:${this.appSecret}`)
      .digest('hex');
    return {
      system: { ver: '1.0', appId: this.appId, time, nonce, sign },
      params,
      id: randomUUID(),
    };
  }

  /** One raw call: the `data` of the answer, or an ImouError. */
  async send(method, params) {
    const url = `https://${this.host}/openapi/${method}`;
    this.calls += 1;
    let answer;
    try {
      answer = await this.transport.post(url, this.envelope(params));
    } catch (err) {
      throw new ImouError(ERROR_KINDS.UNREACHABLE, `${method}: ${err.cause?.code ?? err.message}`);
    }
    if (answer.status >= 500 || answer.status === 429) {
      throw new ImouError(ERROR_KINDS.UNREACHABLE, `${method}: HTTP ${answer.status}`);
    }
    if (answer.status !== 200) {
      throw new ImouError(ERROR_KINDS.API, `${method}: HTTP ${answer.status}`);
    }
    let body;
    try {
      body = JSON.parse(answer.text);
    } catch {
      throw new ImouError(ERROR_KINDS.API, `${method}: the answer is not JSON`);
    }
    const result = body?.result;
    if (!result || typeof result !== 'object' || result.code === undefined) {
      throw new ImouError(ERROR_KINDS.API, `${method}: no result in the answer`);
    }
    const code = String(result.code);
    if (code !== '0') {
      const kind = TOKEN_CODES.has(code) ? 'token' : (CODE_KINDS[code] ?? ERROR_KINDS.API);
      throw new ImouError(kind, `${method}: ${code} ${String(result.msg ?? '').trim()}`, code);
    }
    return result.data && typeof result.data === 'object' ? result.data : {};
  }

  /** A token, fetched when none is valid. Concurrent calls share the request. */
  async ensureToken() {
    if (this.hasToken) {
      return;
    }
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = null;
    });
    await this.tokenRequest;
  }

  async fetchToken() {
    const data = await this.send('accessToken', {});
    if (typeof data.accessToken !== 'string' || !data.accessToken) {
      throw new ImouError(ERROR_KINDS.API, 'accessToken: no token in the answer');
    }
    const seconds = Number(data.expireTime);
    const host = apiHost(data.currentDomain);
    if (host) {
      this.host = host;
    }
    this.token = {
      token: data.accessToken,
      // A token of unknown life is kept an hour.
      expiresAt:
        this.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3_600_000),
      host: this.host,
    };
    this.onToken(this.token);
  }

  /** Forget the token (it was refused). */
  dropToken() {
    this.token = null;
    this.onToken(null);
  }

  /** A call with a token; an expired token is renewed once. */
  async call(method, params = {}) {
    await this.ensureToken();
    try {
      return await this.send(method, { ...params, token: this.token.token });
    } catch (err) {
      if (err.kind !== 'token') {
        throw err;
      }
      this.dropToken();
      await this.ensureToken();
      try {
        return await this.send(method, { ...params, token: this.token.token });
      } catch (again) {
        if (again.kind === 'token') {
          throw new ImouError(ERROR_KINDS.AUTH, again.message, again.code);
        }
        throw again;
      }
    }
  }

  // --- Reads -------------------------------------------------------------------

  /** Every device of the account (cameras, doorbells, recorders), page by page. */
  async listDevices() {
    const pageSize = 50;
    const devices = [];
    // Ten pages are 500 devices: far beyond what a free account may hold.
    for (let page = 1; page <= 10; page += 1) {
      const data = await this.call('listDeviceDetailsByPage', { page, pageSize });
      const list = Array.isArray(data.deviceList) ? data.deviceList : [];
      devices.push(...list);
      // Counts what arrived, not `count` (pyimouapi does the same).
      if (list.length < pageSize) {
        break;
      }
    }
    return devices;
  }

  online(deviceId) {
    return this.call('deviceOnline', { deviceId });
  }

  /** A switch of the camera ({ status: "on" | "off" }). */
  switchStatus(deviceId, channelId, enableType) {
    return this.call('getDeviceCameraStatus', { deviceId, channelId, enableType });
  }

  setSwitch(deviceId, channelId, enableType, enable) {
    return this.call('setDeviceCameraStatus', { deviceId, channelId, enableType, enable });
  }

  /** Motion detection (the alarm of the Imou app) on or off. */
  setMotionDetection(deviceId, channelId, enable) {
    return this.call('modifyDeviceAlarmStatus', { deviceId, channelId, enable });
  }

  /**
   * The last alarm messages of a channel, newest first.
   * @param {number} sinceMs start of the window
   */
  async alarms(deviceId, channelId, sinceMs) {
    const data = await this.call('getAlarmMessage', {
      deviceId,
      channelId,
      // A day ahead: the window is read in the time zone of the account,
      // which may be ahead of the container's.
      beginTime: formatTime(sinceMs),
      endTime: formatTime(this.now() + 24 * 3_600_000),
      count: 10,
    });
    return Array.isArray(data.alarms) ? data.alarms : [];
  }

  power(deviceId) {
    return this.call('getDevicePowerInfo', { deviceId });
  }

  sdCardStatus(deviceId) {
    return this.call('deviceSdcardStatus', { deviceId });
  }

  storage(deviceId) {
    return this.call('deviceStorage', { deviceId });
  }

  // --- Commands ----------------------------------------------------------------

  /** Ask for a capture: the address of the JPEG, ready a moment later. */
  async snapshot(deviceId, channelId) {
    const data = await this.call('setDeviceSnapEnhanced', { deviceId, channelId });
    if (typeof data.url !== 'string' || !/^https?:\/\//.test(data.url)) {
      throw new ImouError(ERROR_KINDS.API, 'setDeviceSnapEnhanced: no picture address');
    }
    return data.url;
  }

  /** A bounded PTZ move: the camera stops by itself after `durationMs`. */
  move(deviceId, channelId, operation, durationMs) {
    return this.call('controlMovePTZ', {
      deviceId,
      channelId,
      operation: String(operation),
      duration: String(durationMs),
    });
  }

  sirenStart(deviceId) {
    return this.call('sirenStart', { deviceId });
  }

  sirenStop(deviceId) {
    return this.call('sirenStop', { deviceId });
  }

  /** Download a picture (a signed storage address: no token, no signature). */
  async download(url) {
    let answer;
    try {
      answer = await this.transport.get(url);
    } catch (err) {
      throw new ImouError(ERROR_KINDS.UNREACHABLE, `picture: ${err.cause?.code ?? err.message}`);
    }
    if (answer.status !== 200) {
      throw new ImouError(ERROR_KINDS.API, `picture: HTTP ${answer.status}`);
    }
    return answer.bytes;
  }
}
