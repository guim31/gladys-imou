// -----------------------------------------------------------------------------
// The Imou hub: one developer application (AppId/AppSecret) of the Imou Open
// API, read on the container's own timers. The Open API counts every call
// against the quota of the developer account, so each read is one call and
// only the cameras added to Gladys are read:
//
//   - the device list (one call for every camera) every 10 minutes: names,
//     abilities, online state;
//   - the alarm messages of each camera added to Gladys, at the interval of
//     the configuration (1 minute by default): a new alarm pulses the motion
//     (or person, or ring) feature, updates the "last event", publishes its
//     picture as the camera image (or, when Imou encrypts that picture, a
//     fresh capture of a mains-powered camera), then fires the scene triggers
//     — the image first, so a scene sending "the camera image" sends the
//     right one;
//   - the switches (motion detection, privacy mode, floodlight) every 30
//     minutes, battery and SD card every hour, and after a command;
//   - a fresh capture of the mains-powered cameras on the timer of the
//     configuration, never of a battery camera (each capture wakes it up).
// The container refreshes itself: Gladys never polls (should_poll: false,
// GladysAssistant/Gladys#3198); onPoll only asks for an early alarm read.
//
// Quota: when Imou answers that it is used up (OP1013), every read stops for
// an hour. A camera beyond the device licences of the free plan (FL1001) is
// skipped until the next device list.
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added: Gladys drops the others.
//
// Logs: info keeps the lifecycle (connected, cloud lost and back, a camera
// offline and back, user commands); a problem that repeats is logged once,
// and once when it clears; the rest goes to debug (LOG_LEVEL=debug). Never
// the AppSecret, the AppId, a token, nor a picture address.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  MOVES,
  MOVES_BY_PTZ,
  buildCamera,
  cameraIds,
  cameraName,
  featureKeys,
  featureValues,
} from './devices.js';
import { ERROR_KINDS, ImouClient, ImouError, PTZ_OPERATIONS } from './imou/client.js';
import {
  ALARM_KINDS,
  SWITCH_TYPES,
  parseAlarm,
  parseBattery,
  parseDeviceList,
  parseSdState,
  parseStorage,
  parseSwitch,
  SD_STATES,
} from './imou/model.js';
import { isJpeg, toCameraImage } from './image.js';
import {
  ACTION_TEXT,
  ALARM_NAMES,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REGION_NAMES,
  REPORT_TEXT,
  eventText,
  localized,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'imou-hub' });

export const WIDGET_KEY = 'imou';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  MOTION: 'motion_detected',
  PERSON: 'person_detected',
  DOORBELL: 'doorbell_pressed',
});

export const HUB_TIMINGS = {
  // Device list (names, abilities, online state of every camera: one call).
  listMs: 10 * 60_000,
  // Switches every 3 lists, battery and SD card every 6.
  switchesEvery: 3,
  sensorsEvery: 6,
  heartbeatMs: 6 * 60 * 60_000,
  // Motion and person stay 1 this long after an alarm.
  motionMs: 60_000,
  // A ring: 1, then 0 after this.
  ringMs: 10_000,
  // How long the siren shows "on" after a start (the firmware decides when
  // it stops; the switch goes back to 0 after this).
  sirenMs: 60_000,
  // A command wins over a read this soon after it (the cloud lags).
  holdMs: 60_000,
  // The core takes 12 images a minute per camera at most.
  imageSpacingMs: 6_000,
  // "Send the camera image" right after an alarm sends the alarm picture.
  liveReuseMs: 30_000,
  // A capture is stored a moment after setDeviceSnapEnhanced answers
  // (imouapi waits 1.5 s, pyimouapi a configurable delay).
  snapshotWaitMs: 2_000,
  // A scene event waits this long at most for the picture of its alarm.
  eventImageWaitMs: 10_000,
  // An alarm listed later than this is shown, but fires nothing.
  lateAlarmMs: 10 * 60_000,
  // The alarm window: the last day.
  alarmWindowMs: 24 * 3_600_000,
  // Every read stops this long after Imou says the quota is used up.
  quotaPauseMs: 60 * 60_000,
  // A step of camera/move: the camera stops by itself after it.
  moveStepMs: 600,
};

const MAX_SEEN = 2000;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Wait for a promise, `ms` at most (the timer cleared either way). */
function atMost(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);

/** The application a saved token belongs to: never the AppId itself. */
const accountOf = (config) => hash(`${config.appId}|${config.region}`);

const signature = (config) => JSON.stringify([config.appId, config.appSecret, config.region]);

/** The image of a camera as a widget image: the raw base64 of the JPEG. */
const rawBase64 = (image) => image.slice(image.indexOf(',') + 1);

export class ImouHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} [options.transport] HTTP seam (src/imou/http.js)
   * @param {Function} [options.toImage] JPEG → camera image (src/image.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, transport, toImage, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.transport = transport;
    this.toImage = toImage ?? toCameraImage;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    /** Why reads stopped (an ImouError of kind auth), null when they may run. */
    this.blocked = null;
    this.pausedUntil = 0;
    this.read = { ok: null, error: null, downSince: null };
    this.cameras = new Map();
    this.unlicensed = new Set();
    this.detectionType = new Map();
    this.seen = { persons: new Set(), doorbells: new Set() };
    this.alarms = { since: new Map(), seen: new Set(), last: new Map() };
    this.pulses = new Map();
    this.sirens = new Map();
    this.held = new Map();
    this.images = new Map();
    this.imageReads = new Map();
    this.thumbnails = new Map();
    this.online = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovery = null;
    this.reading = null;
    this.checking = null;
    this.rounds = 0;
    this.timers = {};
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or info), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.seen = {
      persons: new Set(Array.isArray(saved.persons) ? saved.persons : []),
      doorbells: new Set(Array.isArray(saved.doorbells) ? saved.doorbells : []),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovery = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const next = signature(config);
    const changed = next !== this.signature;
    this.config = config;
    if (changed) {
      this.signature = next;
      this.blocked = null;
      this.pausedUntil = 0;
      this.read = { ok: null, error: null, downSince: null };
      this.cameras = new Map();
      this.unlicensed.clear();
      this.detectionType.clear();
      this.alarms = { since: new Map(), seen: new Set(), last: new Map() };
      this.online.clear();
      this.client = this.createClient(config);
    }
    this.discovery = null;
    if (!this.client) {
      this.clearTimers();
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.refresh({ switches: true, sensors: true });
    this.schedule();
  }

  createClient(config) {
    if (!config.appId || !config.appSecret) {
      return null;
    }
    const account = accountOf(config);
    const saved = this.store.get('token');
    return new ImouClient({
      appId: config.appId,
      appSecret: config.appSecret,
      host: config.host,
      token: saved?.account === account ? saved : null,
      onToken: (token) => {
        this.store.set('token', token ? { ...token, account } : null);
      },
      transport: this.transport,
      now: this.now,
    });
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    for (const timers of [...this.pulses.values(), this.sirens]) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.pulses.clear();
    this.sirens.clear();
    await this.store.flush();
  }

  clearTimers() {
    for (const timer of Object.values(this.timers)) {
      clearTimeout(timer);
    }
    this.timers = {};
  }

  /** (Re)arm the timers of the hub. */
  schedule() {
    this.clearTimers();
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const loop = (name, interval, run) => {
      if (interval <= 0) {
        return;
      }
      this.timers[name] = setTimeout(async () => {
        await run().catch((err) => logger.debug(`Timer ${name}: ${err.message}`));
        if (!this.stopped && this.timers[name]) {
          loop(name, interval, run);
        }
      }, interval);
    };
    loop('devices', this.timings.listMs, () => this.periodicRefresh());
    loop('alarms', this.config.alarmIntervalMs, () => this.checkAlarms());
    loop('snapshots', this.config.snapshotIntervalMs, () => this.snapshotAll());
  }

  periodicRefresh() {
    this.rounds += 1;
    return this.refresh({
      switches: this.rounds % this.timings.switchesEvery === 0,
      sensors: this.rounds % this.timings.sensorsEvery === 0,
    });
  }

  // --- Calls -------------------------------------------------------------------

  get paused() {
    return this.pausedUntil > this.now();
  }

  /**
   * One call of the client. A refused AppId/AppSecret stops every read until
   * the configuration changes; a used-up quota pauses them for an hour.
   */
  async api(run) {
    if (this.blocked) {
      throw this.blocked;
    }
    if (this.paused) {
      throw new ImouError(ERROR_KINDS.QUOTA, 'reads paused: the Imou call quota is used up');
    }
    try {
      return await run(this.client);
    } catch (err) {
      if (err.kind === ERROR_KINDS.AUTH) {
        this.blocked = err;
        this.problem('auth', `Imou refused the application: ${err.message}`);
      } else if (err.kind === ERROR_KINDS.QUOTA && !this.paused) {
        this.pausedUntil = this.now() + this.timings.quotaPauseMs;
        this.problem(
          'quota',
          `Imou says the call quota is used up (${err.message}): reads paused for an hour`,
        );
        this.publishConnectionStatus().catch(() => {});
      }
      throw err;
    }
  }

  /** A call about one camera: a camera beyond the free licences is noted. */
  async cameraApi(camera, run) {
    try {
      return await this.api(run);
    } catch (err) {
      if (err.kind === ERROR_KINDS.LICENSE && !this.unlicensed.has(camera.key)) {
        this.unlicensed.add(camera.key);
        this.problem(
          `license-${camera.key}`,
          `${cameraName(camera)} is beyond the device licences of the Imou developer plan: skipped`,
        );
      }
      throw err;
    }
  }

  // --- Reading the cloud ---------------------------------------------------------

  /** Read the devices (and their switches or sensors). Concurrent calls share it. */
  refresh(options = {}) {
    this.reading ??= this.readDevices(options).finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readDevices({ switches = false, sensors = false } = {}) {
    const client = this.client;
    if (!client || this.paused || this.blocked) {
      await this.afterChanges();
      return false;
    }
    let list;
    try {
      list = await this.api((current) => current.listDevices());
    } catch (err) {
      if (client === this.client) {
        await this.readFailed(err);
      }
      return false;
    }
    if (client !== this.client) {
      return false; // reconfigured while reading
    }
    this.applyDevices(parseDeviceList(list));
    this.readSucceeded();
    await this.publishDevices();
    for (const camera of this.cameras.values()) {
      if (switches) {
        await this.readSwitches(camera);
      }
      if (sensors) {
        await this.readSensors(camera);
      }
    }
    await this.publishAllStates();
    await this.checkAlarms();
    await this.afterChanges();
    return true;
  }

  /** The new device list: what was read before stays until read again. */
  applyDevices(cameras) {
    const now = this.now();
    for (const [key, hold] of this.held) {
      if (hold.until < now) {
        this.held.delete(key);
      }
    }
    // A new list gives every camera its chance again (licences move).
    this.unlicensed.clear();
    this.cameras = new Map(
      cameras.map((camera) => {
        const before = this.cameras.get(camera.key);
        for (const field of ['detection', 'privacy', 'light', 'battery', 'sd']) {
          camera[field] = before?.[field] ?? null;
        }
        this.applyHolds(camera);
        return [camera.key, camera];
      }),
    );
  }

  applyHolds(camera) {
    for (const field of ['detection', 'privacy', 'light']) {
      const hold = this.held.get(`${camera.key}:${field}`);
      if (hold && hold.until >= this.now()) {
        camera[field] = hold.value;
      }
    }
  }

  /** Whether a camera is read: added to Gladys, in the licences, full API. */
  readable(camera) {
    return (
      this.isCreated(cameraIds(this.gladys, camera.key).device) && !this.unlicensed.has(camera.key)
    );
  }

  /** Motion detection, privacy mode, floodlight: one call each. */
  async readSwitches(camera) {
    if (!this.readable(camera) || camera.iot || camera.status !== 'online') {
      return;
    }
    const read = async (field, types) => {
      for (const type of types) {
        try {
          const value = parseSwitch(
            await this.cameraApi(camera, (client) =>
              client.switchStatus(camera.deviceId, camera.channelId, type),
            ),
          );
          if (value !== null) {
            camera[field] = value;
            if (field === 'detection') {
              this.detectionType.set(camera.key, type);
            }
            return;
          }
        } catch (err) {
          logger.debug(`${cameraName(camera)}: ${type} not read (${err.message})`);
          if (err.kind !== ERROR_KINDS.API) {
            return;
          }
        }
      }
    };
    if (camera.detectionCapable) {
      const known = this.detectionType.get(camera.key);
      await read('detection', known ? [known] : SWITCH_TYPES.detection);
    }
    if (camera.privacyCapable) {
      await read('privacy', SWITCH_TYPES.privacy);
    }
    if (camera.lightCapable) {
      await read('light', SWITCH_TYPES.light);
    }
    this.applyHolds(camera);
  }

  /** Battery and SD card. A sleeping camera is not woken for its SD card. */
  async readSensors(camera) {
    if (!this.readable(camera) || camera.iot || camera.status === 'offline') {
      return;
    }
    const quiet = (what) => (err) => {
      logger.debug(`${cameraName(camera)}: ${what} not read (${err.message})`);
      return null;
    };
    if (camera.batteryPowered) {
      const data = await this.cameraApi(camera, (client) => client.power(camera.deviceId)).catch(
        quiet('battery'),
      );
      camera.battery = parseBattery(data) ?? camera.battery;
    }
    if (camera.sdCapable && !camera.dormant && camera.status === 'online') {
      let state;
      try {
        state = parseSdState(
          await this.cameraApi(camera, (client) => client.sdCardStatus(camera.deviceId)),
        );
      } catch (err) {
        state = err.kind === ERROR_KINDS.NO_STORAGE ? SD_STATES.NONE : quiet('SD card')(err);
      }
      if (state === SD_STATES.NORMAL) {
        const storage = parseStorage(
          await this.cameraApi(camera, (client) => client.storage(camera.deviceId)).catch(
            quiet('SD card space'),
          ),
        );
        camera.sd = {
          state,
          capacityGb: storage?.capacityGb ?? null,
          freeGb: storage?.freeGb ?? null,
        };
      } else if (state) {
        // No card: no room to record, 0 is the truth (and trips a "low space" scene).
        const empty = state === SD_STATES.NONE ? 0 : null;
        camera.sd = { state, capacityGb: empty, freeGb: empty };
      }
    }
  }

  readSucceeded() {
    const wasDown = this.read.ok === false;
    const first = this.read.ok === null;
    this.read.ok = true;
    this.read.error = null;
    if (first) {
      logger.info(
        `Connected to the Imou Open API (${this.client.host}): ${this.cameras.size} camera(s)`,
      );
    } else if (wasDown) {
      const minutes = Math.max(1, Math.round((this.now() - this.read.downSince) / 60_000));
      logger.info(`The Imou cloud answers again after ${minutes} min`);
    }
    this.warned.delete('read');
    this.resolved('quota', 'Imou calls: accepted again');
    this.read.downSince = null;
  }

  async readFailed(err) {
    if (this.blocked) {
      // Not an outage: the application waits for the user (status, widget).
      await this.afterChanges();
      return;
    }
    if (this.read.ok !== false) {
      this.read.downSince = this.now();
    }
    this.read.ok = false;
    this.read.error = err;
    if (err.kind !== ERROR_KINDS.QUOTA) {
      this.problem(
        'read',
        `Cannot read the Imou cloud: ${err.message}`,
        err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn',
      );
    }
    await this.afterChanges();
  }

  // --- Alarms ------------------------------------------------------------------

  /** Read the alarm messages. Concurrent calls share the read. */
  checkAlarms() {
    this.checking ??= this.readAlarms().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  async readAlarms() {
    if (!this.client || this.paused || this.blocked) {
      return false;
    }
    let fresh = false;
    for (const camera of [...this.cameras.values()]) {
      if (!this.readable(camera) || camera.status === 'offline') {
        continue;
      }
      let messages;
      try {
        messages = await this.cameraApi(camera, (client) =>
          client.alarms(camera.deviceId, camera.channelId, this.now() - this.timings.alarmWindowMs),
        );
        this.resolved(`alarms-${camera.key}`, `Alarms of ${cameraName(camera)}: read again`);
      } catch (err) {
        if (err.kind === ERROR_KINDS.QUOTA || err.kind === ERROR_KINDS.AUTH) {
          return false;
        }
        if (err.kind !== ERROR_KINDS.LICENSE) {
          this.problem(
            `alarms-${camera.key}`,
            `Cannot read the alarms of ${cameraName(camera)}: ${err.message}`,
            'info',
          );
        }
        continue;
      }
      if (await this.applyAlarms(camera, messages)) {
        fresh = true;
      }
    }
    if (fresh) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    return true;
  }

  /**
   * The alarms of one camera. Those older than the moment the camera was
   * first followed (the start, or its addition to Gladys) only show as its
   * last event; the newer ones fire, unless Imou lists them very late.
   */
  async applyAlarms(camera, messages) {
    if (!this.alarms.since.has(camera.key)) {
      this.alarms.since.set(camera.key, this.now());
    }
    const since = this.alarms.since.get(camera.key);
    const alarms = messages
      .map(parseAlarm)
      .filter(Boolean)
      .sort((a, b) => a.at - b.at);
    const fresh = [];
    let known = false;
    for (const alarm of alarms) {
      const id = `${camera.key}:${alarm.id}`;
      if (this.alarms.seen.has(id)) {
        continue;
      }
      this.remember(camera, id, alarm);
      known = true;
      const late = this.now() - alarm.at > this.timings.lateAlarmMs;
      if (alarm.at >= since && !late) {
        fresh.push(alarm);
      }
    }
    if (fresh.length === 0) {
      if (known) {
        await this.publishStates(camera);
      }
      return false;
    }
    for (const alarm of fresh) {
      await this.alarmed(camera, alarm);
    }
    return true;
  }

  remember(camera, id, alarm) {
    this.alarms.seen.add(id);
    if (this.alarms.seen.size > MAX_SEEN) {
      this.alarms.seen = new Set([...this.alarms.seen].slice(-MAX_SEEN / 2));
    }
    const last = this.alarms.last.get(camera.key);
    if (!last || alarm.at >= last.at) {
      this.alarms.last.set(camera.key, alarm);
    }
  }

  /** A camera learns a feature its abilities did not announce (person, doorbell). */
  async learn(camera, set, storeKey, what) {
    if (this.seen[set].has(camera.key)) {
      return;
    }
    this.seen[set].add(camera.key);
    this.store.set(storeKey, [...this.seen[set]]);
    logger.info(`${cameraName(camera)} reported ${what}: it gets that feature`);
    await this.publishDevices();
  }

  /** A new alarm: pulses, last event, picture, then the scene events. */
  async alarmed(camera, alarm) {
    logger.debug(`Alarm on ${cameraName(camera)}: ${alarm.kind} (${alarm.msgType || '-'})`);
    const ids = cameraIds(this.gladys, camera.key);
    if (alarm.kind === ALARM_KINDS.DOORBELL) {
      if (!camera.doorbell) {
        await this.learn(camera, 'doorbells', 'doorbells', 'a ring');
      }
      this.pulse(camera, FEATURE_KEYS.RING, this.timings.ringMs);
    } else if (alarm.kind === ALARM_KINDS.PERSON) {
      if (!camera.personCapable) {
        await this.learn(camera, 'persons', 'persons', 'a person');
      }
      this.pulse(camera, FEATURE_KEYS.PERSON, this.timings.motionMs);
      this.pulse(camera, FEATURE_KEYS.MOTION, this.timings.motionMs);
    } else if (alarm.kind === ALARM_KINDS.MOTION) {
      this.pulse(camera, FEATURE_KEYS.MOTION, this.timings.motionMs);
    }
    await this.publishStates(camera);
    if (alarm.kind === ALARM_KINDS.OTHER) {
      return;
    }
    // The picture first, waited a few seconds at most (only the newest alarm
    // of the camera: an older one of the same batch would be replaced at once).
    if (this.alarms.last.get(camera.key)?.id === alarm.id) {
      await atMost(this.alarmImage(camera, alarm), this.timings.eventImageWaitMs);
    }
    const name = this.nameOf(camera);
    const kinds = pick(ALARM_NAMES, this.language);
    if (alarm.kind === ALARM_KINDS.DOORBELL) {
      await this.fire(TRIGGERS.DOORBELL, { doorbell: ids.device, doorbell_name: name });
      return;
    }
    if (alarm.kind === ALARM_KINDS.PERSON) {
      await this.fire(TRIGGERS.PERSON, { camera: ids.device, camera_name: name });
    }
    await this.fire(TRIGGERS.MOTION, {
      camera: ids.device,
      camera_name: name,
      kind: alarm.kind,
      kind_name: kinds[alarm.kind],
    });
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /** A momentary feature: 1 now (published by the caller), 0 after `ms`. */
  pulse(camera, key, ms) {
    const timers = this.pulses.get(camera.key) ?? new Map();
    this.pulses.set(camera.key, timers);
    clearTimeout(timers.get(key));
    const timer = setTimeout(() => {
      timers.delete(key);
      const current = this.cameras.get(camera.key);
      if (current && !this.stopped) {
        this.publishStates(current).catch(() => {});
      }
    }, ms);
    timer.unref?.();
    timers.set(key, timer);
  }

  // --- Pictures ------------------------------------------------------------------

  /**
   * The picture of an alarm. Imou encrypts the alarm pictures of many cameras
   * (Imou-Home-Assistant needs Imou's native library to open them): a picture
   * that is not a JPEG is replaced by a fresh capture of a mains-powered
   * camera, which is taken right after the alarm.
   */
  async alarmImage(camera, alarm) {
    if (alarm.picture) {
      try {
        const bytes = await this.cameraApi(camera, (client) => client.download(alarm.picture));
        if (isJpeg(bytes)) {
          return await this.keepImage(camera, await this.toImage(bytes), `alarm-${hash(alarm.id)}`);
        }
        logger.debug(`${cameraName(camera)}: the alarm picture is encrypted`);
      } catch (err) {
        logger.debug(`${cameraName(camera)}: alarm picture not read (${err.message})`);
      }
    }
    if (camera.batteryPowered || camera.privacy === true || camera.status !== 'online') {
      return null;
    }
    return this.cameraImage(camera, { fresh: true });
  }

  /**
   * A fresh capture of a camera. Concurrent calls share the read; a capture
   * younger than `reuseMs` is reused (the core takes 12 images a minute per
   * camera).
   * @returns {Promise<string|null>}
   */
  cameraImage(camera, { fresh = false, reuseMs = this.timings.imageSpacingMs } = {}) {
    const last = this.images.get(camera.key);
    if (!fresh && last && this.now() - last.at < reuseMs) {
      return Promise.resolve(last.image);
    }
    const running = this.imageReads.get(camera.key);
    if (running) {
      return running;
    }
    const read = this.capture(camera).finally(() => this.imageReads.delete(camera.key));
    this.imageReads.set(camera.key, read);
    return read;
  }

  async capture(camera) {
    let image;
    try {
      const url = await this.cameraApi(camera, (client) =>
        client.snapshot(camera.deviceId, camera.channelId),
      );
      let bytes = null;
      // The capture is stored a moment after the answer: wait, try twice.
      for (let attempt = 0; attempt < 2 && !bytes; attempt += 1) {
        await delay(this.timings.snapshotWaitMs);
        try {
          bytes = await this.client.download(url);
        } catch (err) {
          if (attempt === 1) {
            throw err;
          }
        }
      }
      if (!isJpeg(bytes)) {
        throw new ImouError(ERROR_KINDS.API, 'the capture is not a JPEG image (encrypted?)');
      }
      image = await this.toImage(bytes);
      this.resolved(`image-${camera.key}`, `Captures of ${cameraName(camera)}: back`);
    } catch (err) {
      this.problem(
        `image-${camera.key}`,
        `No capture from ${cameraName(camera)}: ${err.message}`,
        [
          ERROR_KINDS.OFFLINE,
          ERROR_KINDS.SLEEPING,
          ERROR_KINDS.QUOTA,
          ERROR_KINDS.LICENSE,
        ].includes(err.kind)
          ? 'info'
          : 'warn',
      );
      return null;
    }
    return this.keepImage(camera, image, `capture-${hash(`${camera.key}${this.now()}`)}`);
  }

  /** Publish an image to Gladys and keep it for the widget. */
  async keepImage(camera, image, imageKey) {
    const before = this.images.get(camera.key);
    if (before?.imageKey && before.imageKey !== imageKey) {
      this.thumbnails.delete(before.imageKey);
    }
    this.images.set(camera.key, { at: this.now(), image, imageKey });
    this.thumbnails.set(imageKey, rawBase64(image));
    const externalId = cameraIds(this.gladys, camera.key).device;
    if (this.isCreated(externalId)) {
      try {
        await this.gladys.publishCameraImage(externalId, image);
        this.resolved('camera-image');
      } catch (err) {
        this.problem('camera-image', `Image of ${cameraName(camera)} refused: ${err.message}`);
      }
    }
    return image;
  }

  /** The timer of the configuration: every added, online, mains-powered camera. */
  async snapshotAll() {
    if (this.paused || this.blocked) {
      return;
    }
    const half = (this.config?.snapshotIntervalMs ?? 0) / 2;
    for (const camera of this.cameras.values()) {
      const last = this.images.get(camera.key);
      // A battery camera would be woken up; one imaged half a period ago is fresh.
      if (
        camera.status !== 'online' ||
        camera.batteryPowered ||
        camera.privacy === true ||
        !this.readable(camera) ||
        (last && this.now() - last.at < half)
      ) {
        continue;
      }
      await this.cameraImage(camera);
    }
  }

  /**
   * Gladys asks for a fresh image. In Gladys 5.2.1 only the "send camera
   * image" and "ask the AI" scene actions do: the camera box of the dashboard
   * shows the last image published and never asks. An image of the last 30
   * seconds is the one of the alarm that started the scene: sent as is.
   */
  async getImage(device) {
    const camera = this.findCamera(device.external_id);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    const image =
      (camera.privacy === true
        ? null
        : await this.cameraImage(camera, { reuseMs: this.timings.liveReuseMs })) ??
      this.images.get(camera.key)?.image;
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /**
   * The name a person reads for a camera: the one it has in Gladys once added,
   * else the Imou one. The SDK keeps `gladys.devices` up to date.
   */
  nameOf(camera, language = this.language) {
    const externalId = cameraIds(this.gladys, camera.key).device;
    const created = (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
    const name = typeof created?.name === 'string' ? created.name.trim() : '';
    return name || cameraName(camera, language);
  }

  /** Whether the user added the device to Gladys. */
  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  featureOptions(camera) {
    return {
      person: this.seen.persons.has(camera.key),
      doorbell: this.seen.doorbells.has(camera.key),
      allowSiren: this.config?.allowSiren,
    };
  }

  async publishDevices() {
    const devices = [...this.cameras.values()].map((camera) =>
      buildCamera(this.gladys, camera, { language: this.language, ...this.featureOptions(camera) }),
    );
    const key = JSON.stringify(devices);
    if (key === this.discovery) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovery = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: publish the devices again after a read. */
  async rediscover() {
    this.discovery = null;
    if (!(await this.refresh())) {
      await this.publishDevices();
    }
  }

  /** The user added a camera: read it, send its values and an image. */
  async onDeviceCreated(device) {
    const camera = this.findCamera(device.external_id);
    if (!camera) {
      return;
    }
    // Followed from now on: an alarm from now fires, even before the next read.
    if (!this.alarms.since.has(camera.key)) {
      this.alarms.since.set(camera.key, this.now());
    }
    // Its switches and sensors were not read before (only added cameras are).
    await this.readSwitches(camera).catch(() => {});
    await this.readSensors(camera).catch(() => {});
    await this.publishStates(camera);
    await this.publishTransports();
    const image = this.images.get(camera.key)?.image;
    if (image) {
      await this.gladys.publishCameraImage(device.external_id, image).catch(() => {});
    } else if (camera.status === 'online' && !camera.batteryPowered && camera.privacy !== true) {
      this.cameraImage(camera).catch(() => {});
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishAllStates() {
    for (const camera of this.cameras.values()) {
      await this.publishStates(camera);
    }
  }

  /** The current values of one camera, sent if they changed. */
  async publishStates(camera) {
    if (!camera) {
      return;
    }
    const ids = cameraIds(this.gladys, camera.key);
    if (!this.isCreated(ids.device)) {
      return;
    }
    const pulses = this.pulses.get(camera.key);
    const last = this.alarms.last.get(camera.key);
    const values = featureValues(
      camera,
      {
        motion: pulses?.has(FEATURE_KEYS.MOTION),
        person: pulses?.has(FEATURE_KEYS.PERSON),
        ring: pulses?.has(FEATURE_KEYS.RING),
        siren: this.sirens.has(camera.key),
        lastEvent: last ? eventText(last, this.language, this.now()) : null,
      },
      this.language,
    );
    const states = featureKeys(camera, this.featureOptions(camera))
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) =>
        typeof values[key] === 'object'
          ? { device_feature_external_id: ids.feature(key), text: values[key].text }
          : { device_feature_external_id: ids.feature(key), state: values[key] },
      );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${cameraName(camera)} refused: ${err.message}`);
    }
  }

  /** After a read: cameras offline and back, transports, status, widget. */
  async afterChanges() {
    let changed = false;
    for (const camera of this.cameras.values()) {
      const online = camera.status !== 'offline';
      const before = this.online.get(camera.key);
      if (before !== undefined && before !== online) {
        // A battery camera that drops off is not news worth a line.
        const line = `${cameraName(camera)} is ${online ? 'online again' : 'offline'}`;
        if (camera.batteryPowered) {
          logger.debug(line);
        } else {
          logger.info(line);
        }
      }
      if (before !== online) {
        changed = true;
      }
      this.online.set(camera.key, online);
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const camera of this.cameras.values()) {
      const externalId = cameraIds(this.gladys, camera.key).device;
      if (!this.isCreated(externalId)) {
        continue;
      }
      const transport =
        this.read.ok !== false && camera.status !== 'offline'
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noAccount };
    }
    if (this.blocked) {
      return { connected: false, message: ERROR_TEXT[ERROR_KINDS.AUTH] };
    }
    if (this.paused) {
      return { connected: false, message: CONNECTION_TEXT.paused };
    }
    if (this.read.ok === false) {
      return { connected: false, message: ERROR_TEXT[this.read.error.kind] ?? ERROR_TEXT.api };
    }
    if (this.read.ok === null) {
      return null; // first read not done yet
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!status) {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ------------------------------------------------------------------

  /** The camera of a Gladys external id, null when unknown. */
  findCamera(externalId) {
    if (!externalId) {
      return null;
    }
    for (const camera of this.cameras.values()) {
      if (cameraIds(this.gladys, camera.key).device === externalId) {
        return camera;
      }
    }
    return null;
  }

  /** The camera a scene action or a widget button names. */
  requireCamera(externalId) {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    if (!externalId) {
      throw new Error(pick(ACTION_TEXT.pickCamera, this.language));
    }
    const camera = this.findCamera(externalId);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    return camera;
  }

  /** A command from Gladys on a camera feature. */
  async setValue(device, feature, value) {
    const camera = this.findCamera(device.external_id);
    if (!camera || !feature.external_id.startsWith(`${device.external_id}:`)) {
      throw new Error(`No command for ${feature.external_id}`);
    }
    const key = feature.external_id.slice(device.external_id.length + 1);
    const on = Number(value) === 1;
    const name = cameraName(camera);
    switch (key) {
      case FEATURE_KEYS.MOVE:
        await this.move(camera, Number(value), 'Gladys');
        return;
      case FEATURE_KEYS.LIGHT:
        await this.command(name, () =>
          this.cameraApi(camera, (client) =>
            client.setSwitch(camera.deviceId, camera.channelId, SWITCH_TYPES.light[0], on),
          ),
        );
        this.hold(camera, 'light', on);
        logger.info(`${name}: floodlight ${on ? 'on' : 'off'}`);
        break;
      case FEATURE_KEYS.SIREN:
        await this.siren(camera, on);
        break;
      case FEATURE_KEYS.DETECTION:
      case FEATURE_KEYS.PRIVACY:
        // Read-only features (see src/devices.js): never a switch.
        throw new Error(pick(ACTION_TEXT.readOnly, this.language));
      default:
        throw new Error(`No command for ${feature.external_id}`);
    }
    await this.publishStates(camera);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** A state just commanded: it wins over the reads for a while (the cloud lags). */
  hold(camera, field, state) {
    camera[field] = state;
    this.held.set(`${camera.key}:${field}`, {
      value: state,
      until: this.now() + this.timings.holdMs,
    });
  }

  /** Run a command; its failure is one warning line, then thrown in the user's language. */
  async command(name, run) {
    try {
      return await run();
    } catch (err) {
      logger.warn(`${name}: command failed: ${err.message}`);
      if (err instanceof ImouError) {
        throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.api, this.language), {
          cause: err,
        });
      }
      throw err;
    }
  }

  /** camera/move: one bounded step, or stop (0). */
  async move(camera, value, from) {
    const allowed = MOVES_BY_PTZ[camera.ptz] ?? [];
    if (value !== 0 && !allowed.includes(value)) {
      throw new Error(pick(ACTION_TEXT.notPtz, this.language));
    }
    const operation = value === 0 ? 'stop' : MOVES[value];
    await this.command(cameraName(camera), () =>
      this.cameraApi(camera, (client) =>
        client.move(
          camera.deviceId,
          camera.channelId,
          PTZ_OPERATIONS[operation],
          this.timings.moveStepMs,
        ),
      ),
    );
    logger.info(`${from}: ${cameraName(camera)} ${value === 0 ? 'stopped' : `moved ${operation}`}`);
  }

  /** The siren: only when allowed; "on" for the time the firmware lets it sound. */
  async siren(camera, on) {
    if (!this.config?.allowSiren || !camera.sirenCapable) {
      throw new Error(pick(ACTION_TEXT.sirenNotAllowed, this.language));
    }
    await this.command(cameraName(camera), () =>
      this.cameraApi(camera, (client) =>
        on ? client.sirenStart(camera.deviceId) : client.sirenStop(camera.deviceId),
      ),
    );
    clearTimeout(this.sirens.get(camera.key));
    this.sirens.delete(camera.key);
    if (on) {
      const timer = setTimeout(() => {
        this.sirens.delete(camera.key);
        if (!this.stopped) {
          this.publishStates(this.cameras.get(camera.key)).catch(() => {});
        }
      }, this.timings.sirenMs);
      timer.unref?.();
      this.sirens.set(camera.key, timer);
    }
    logger.info(`${cameraName(camera)}: siren ${on ? 'on' : 'off'}`);
  }

  /**
   * Privacy mode on (lens covered: surveillance off) or off. Covering the
   * lens needs "Allow turning surveillance off" in the configuration.
   */
  async setPrivacy(externalId, on, from) {
    const camera = this.requireCamera(externalId);
    if (!camera.privacyCapable || camera.iot) {
      throw new Error(pick(ACTION_TEXT.noPrivacy, this.language));
    }
    if (on && !this.config.allowDisarm) {
      throw new Error(pick(ACTION_TEXT.disarmNotAllowed, this.language));
    }
    await this.command(cameraName(camera), () =>
      this.cameraApi(camera, (client) =>
        client.setSwitch(camera.deviceId, camera.channelId, SWITCH_TYPES.privacy[0], on),
      ),
    );
    this.hold(camera, 'privacy', on);
    logger.info(`${from}: ${cameraName(camera)} privacy mode ${on ? 'on' : 'off'}`);
    await this.publishStates(camera);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return camera;
  }

  /**
   * Motion detection on or off. Switching it off needs "Allow turning
   * surveillance off" in the configuration.
   */
  async setDetection(externalId, on, from) {
    const camera = this.requireCamera(externalId);
    if (!camera.detectionCapable || camera.iot) {
      throw new Error(pick(ACTION_TEXT.noDetection, this.language));
    }
    if (!on && !this.config.allowDisarm) {
      throw new Error(pick(ACTION_TEXT.disarmNotAllowed, this.language));
    }
    await this.command(cameraName(camera), () =>
      this.cameraApi(camera, (client) =>
        client.setMotionDetection(camera.deviceId, camera.channelId, on),
      ),
    );
    this.hold(camera, 'detection', on);
    logger.info(`${from}: ${cameraName(camera)} motion detection ${on ? 'on' : 'off'}`);
    await this.publishStates(camera);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return camera;
  }

  /** Scene action: one step in a direction. */
  async moveCamera(externalId, direction) {
    const camera = this.requireCamera(externalId);
    const value = Number(Object.keys(MOVES).find((key) => MOVES[key] === direction));
    if (!value || camera.iot) {
      throw new Error(pick(ACTION_TEXT.notPtz, this.language));
    }
    await this.move(camera, value, 'Scene action');
  }

  /** Scene action and widget: a capture now, sent to Gladys. */
  async refreshSnapshot(externalId, from) {
    const camera = this.requireCamera(externalId);
    logger.info(`${from}: fresh image of ${cameraName(camera)}`);
    const image = await this.cameraImage(camera, { fresh: true });
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return image;
  }

  // --- Quota -----------------------------------------------------------------------

  /** About how many calls a day the settings cost, for the report and the docs. */
  callsPerDay() {
    const created = [...this.cameras.values()].filter((camera) => this.readable(camera));
    const day = 24 * 3_600_000;
    let calls = day / this.timings.listMs;
    for (const camera of created) {
      calls += day / this.config.alarmIntervalMs;
      if (!camera.iot) {
        const switches =
          (camera.detectionCapable ? 1 : 0) +
          (camera.privacyCapable ? 1 : 0) +
          (camera.lightCapable ? 1 : 0);
        calls += (switches * day) / (this.timings.listMs * this.timings.switchesEvery);
        const sensors =
          (camera.batteryPowered ? 1 : 0) + (camera.sdCapable && !camera.dormant ? 2 : 0);
        calls += (sensors * day) / (this.timings.listMs * this.timings.sensorsEvery);
      }
      if (!camera.batteryPowered && this.config.snapshotIntervalMs > 0) {
        calls += day / this.config.snapshotIntervalMs;
      }
    }
    return Math.round(calls / 10) * 10;
  }

  // --- Configuration action ----------------------------------------------------------

  /** "Test the connection": read now, report in four languages. */
  async testConnection() {
    if (!this.client) {
      return CONNECTION_TEXT.noAccount;
    }
    // The user asked: one more try, even after a refusal or a pause.
    this.blocked = null;
    this.pausedUntil = 0;
    this.resolved('auth');
    const ok = await this.refresh({ switches: true, sensors: true });
    if (!ok) {
      const err = this.blocked ?? this.read.error;
      logger.info(`Connection test: failed (${err?.message ?? 'no answer'})`);
      await this.publishConnectionStatus();
      return ERROR_TEXT[err?.kind] ?? ERROR_TEXT.api;
    }
    logger.info('Connection test: success');
    const unlicensed = [...this.cameras.values()].filter((camera) =>
      this.unlicensed.has(camera.key),
    );
    const iot = [...this.cameras.values()].filter((camera) => camera.iot).length;
    return localized((language) => {
      const text = REPORT_TEXT[language];
      const parts = [
        text.ok(this.cameras.size, pick(REGION_NAMES, language)[this.config.region]),
        text.calls(this.callsPerDay()),
      ];
      if (unlicensed.length > 0) {
        parts.push(
          text.license(unlicensed.map((camera) => this.nameOf(camera, language)).join(', ')),
        );
      }
      if (iot > 0) {
        parts.push(text.iot(iot));
      }
      return parts.join(' ');
    });
  }

  // --- Widget ----------------------------------------------------------------------

  /** What the widget shows. */
  view() {
    return {
      configured: Boolean(this.client),
      reachable: this.blocked || this.paused ? false : this.read.ok,
      error: this.blocked ?? (this.paused ? new ImouError(ERROR_KINDS.QUOTA, '') : this.read.error),
      cameras: [...this.cameras.values()],
      allowDisarm: Boolean(this.config?.allowDisarm),
      lastAlarms: this.alarms.last,
      images: this.images,
      now: this.now(),
      cameraId: (camera) => cameraIds(this.gladys, camera.key).device,
      nameOf: (camera, language) => this.nameOf(camera, language),
    };
  }

  /** The raw base64 of a widget image. */
  thumbnail(key) {
    const image = this.thumbnails.get(key);
    if (!image) {
      throw new Error(`Unknown image ${key}`);
    }
    return image;
  }
}
