// -----------------------------------------------------------------------------
// What the integration understands of the Imou Open API answers.
//
// Device list (`listDeviceDetailsByPage`, as Imou-OpenPlatform/pyimouapi reads
// it): a device has an id (its serial number), a name, a model, a status, a
// comma-separated `deviceAbility` and a `channelList`, each channel with its
// own `channelAbility`. A camera is one channel; a recorder or a multi-lens
// camera has several. A device without channel (an alarm-gateway accessory)
// is not a camera and is left out.
//
// Abilities: the names of open.imoulife.com/book/en/faq/ability.html, which
// say what a camera has (the lists in imouapi/const.py and pyimouapi/const.py).
// They are compared without case: the firmware writes them both ways.
//
// Alarms (`getAlarmMessage`): `msgType` names the event (videoMotion, human,
// callEvent…), the sets come from Imou-Home-Assistant (binary_sensor.py and
// event.py); `time` is a Unix time in seconds.
// -----------------------------------------------------------------------------

export const ALARM_KINDS = Object.freeze({
  MOTION: 'motion',
  PERSON: 'person',
  DOORBELL: 'doorbell',
  OTHER: 'other',
});

const PERSON_TYPES = new Set([
  'human',
  'humandetect',
  'headerdetect',
  'aihuman',
  'smdhuman',
  'facedetect',
]);

const MOTION_TYPES = new Set([
  'videomotion',
  'mobiledetect',
  'motiondetect',
  'alarmpir',
  'pir_alarm',
  'aiperarea',
  'aiperareaalarm',
  'multivideoaiperarea',
  'multivideoaiperareaalarm',
  'smartmixdetect',
  'crosslinedetection',
  'areadetect',
  'areadetectalarm',
  'multivideoareadetect',
  'multivideodetectalarm',
]);

const DOORBELL_TYPES = new Set([
  'callbellevent',
  'callevent',
  'callquickevent',
  'callsupplyevent',
  'calleventcall',
]);

/** The kind of an alarm `msgType` ("e_" prefixed in the pushes, plain in the lists). */
export function alarmKind(msgType) {
  const key = String(msgType ?? '')
    .toLowerCase()
    .replace(/^e_/, '');
  if (PERSON_TYPES.has(key)) {
    return ALARM_KINDS.PERSON;
  }
  if (DOORBELL_TYPES.has(key)) {
    return ALARM_KINDS.DOORBELL;
  }
  if (MOTION_TYPES.has(key)) {
    return ALARM_KINDS.MOTION;
  }
  return ALARM_KINDS.OTHER;
}

// Abilities → what the integration offers. Several names for one thing: the
// firmware generations differ.
const ABILITIES = {
  detection: ['AlarmMD', 'MobileDetect'],
  privacy: ['CloseCamera'],
  light: ['WhiteLight', 'ChnWhiteLight', 'WLV2'],
  siren: ['Siren'],
  battery: ['Electric', 'Dormant'],
  dormant: ['Dormant'],
  sd: ['LocalStorage', 'LocalStorageEnable', 'ChnLocalStorage'],
  person: ['HeaderDetect', 'AiHuman', 'AiHumanCar', 'SMDH', 'VideoMotionSMD'],
  doorbell: ['CallAbility', 'CAV2'],
};

// The switches read with getDeviceCameraStatus: their `enableType`.
export const SWITCH_TYPES = Object.freeze({
  // Motion detection: one name or the other depending on the firmware; on
  // when either is (pyimouapi).
  detection: ['motionDetect', 'mobileDetect'],
  privacy: ['closeCamera'],
  light: ['whiteLight'],
});

/** A comma-separated ability list as a lower-case set. */
const abilitySet = (...lists) =>
  new Set(
    lists
      .flatMap((list) => (typeof list === 'string' ? list.split(',') : []))
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

const hasAny = (abilities, names) => names.some((name) => abilities.has(name.toLowerCase()));

/**
 * What a camera can pan, tilt or zoom: `ptz` (all, zoom included), `pt` (four
 * directions), `pan` (left and right only, PT2), or null.
 */
function ptzOf(abilities) {
  if (abilities.has('ptz')) {
    return 'ptz';
  }
  if (abilities.has('pt') || abilities.has('pt1')) {
    return 'pt';
  }
  if (abilities.has('pt2')) {
    return 'pan';
  }
  return null;
}

/** "online", "offline", "sleep" or "upgrading", from the many spellings of the API. */
export function parseStatus(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['1', 'online', 'on'].includes(value)) {
    return 'online';
  }
  if (['4', 'sleep', 'dormant'].includes(value)) {
    return 'sleep';
  }
  if (['3', 'upgrading', 'upgrade'].includes(value)) {
    return 'upgrading';
  }
  return 'offline';
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The cameras of a device list: one per channel.
 * @param {Array<object>} devices raw `deviceList` entries
 * @returns {Array<object>}
 */
export function parseDeviceList(devices) {
  const cameras = [];
  for (const device of Array.isArray(devices) ? devices : []) {
    const deviceId = text(device?.deviceId);
    const channels = Array.isArray(device?.channelList)
      ? device.channelList
      : Array.isArray(device?.channels)
        ? device.channels
        : [];
    if (!deviceId || channels.length === 0) {
      continue;
    }
    const multi = channels.length > 1 || Number(device.channelNum) > 1;
    for (const channel of channels) {
      const channelId = String(channel?.channelId ?? '0');
      const abilities = abilitySet(
        device.deviceAbility ?? device.ability,
        channel?.channelAbility ?? channel?.ability,
      );
      const deviceName = text(device.deviceName ?? device.name);
      const channelName = text(channel?.channelName);
      cameras.push({
        // The platform id of the Gladys device: the serial, plus the channel
        // when the device has several (a recorder, a dual-lens camera).
        key: multi ? `${deviceId}-ch${channelId}` : deviceId,
        deviceId,
        channelId,
        multi,
        name: multi ? channelName || `${deviceName} ${Number(channelId) + 1}` : deviceName,
        model: text(device.deviceModel),
        firmware: text(device.deviceVersion ?? device.version),
        // Newer devices of the "IoT" platform carry a product id and answer
        // other calls (properties by reference): only the basics here.
        iot: Boolean(device.productId),
        status: parseStatus(channel?.channelStatus ?? device.deviceStatus ?? device.status),
        ptz: ptzOf(abilities),
        detectionCapable: hasAny(abilities, ABILITIES.detection),
        privacyCapable: hasAny(abilities, ABILITIES.privacy),
        lightCapable: hasAny(abilities, ABILITIES.light),
        sirenCapable: hasAny(abilities, ABILITIES.siren),
        batteryPowered: hasAny(abilities, ABILITIES.battery),
        dormant: hasAny(abilities, ABILITIES.dormant),
        sdCapable: hasAny(abilities, ABILITIES.sd),
        personCapable: hasAny(abilities, ABILITIES.person),
        doorbell: hasAny(abilities, ABILITIES.doorbell),
        // Read later, null until then.
        detection: null,
        privacy: null,
        light: null,
        battery: null,
        sd: null,
      });
    }
  }
  return cameras;
}

/** The status of a channel in a `deviceOnline` answer. */
export function parseOnline(data, channelId) {
  const channel = (Array.isArray(data?.channels) ? data.channels : []).find(
    (entry) => String(entry?.channelId) === String(channelId),
  );
  return parseStatus(channel?.onLine ?? data?.onLine);
}

/** A switch state from getDeviceCameraStatus: true, false or null. */
export function parseSwitch(data) {
  const status = String(data?.status ?? '').toLowerCase();
  return status === 'on' ? true : status === 'off' ? false : null;
}

/** The battery level (0-100) of a getDevicePowerInfo answer, null when absent. */
export function parseBattery(data) {
  const entry = Array.isArray(data?.electricitys) ? data.electricitys[0] : null;
  if (!entry) {
    return null;
  }
  // Lithium, else alkaline, else the generic level (pyimouapi's order).
  for (const key of ['litElec', 'alkElec', 'electric']) {
    const value = Number(entry[key]);
    if (entry[key] !== undefined && entry[key] !== '' && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }
  }
  return null;
}

export const SD_STATES = Object.freeze({
  NORMAL: 'normal',
  NONE: 'none',
  FORMATTING: 'formatting',
  ERROR: 'error',
});

/** The SD card state of a deviceSdcardStatus answer. */
export function parseSdState(data) {
  const status = String(data?.status ?? '').toLowerCase();
  if (status === 'normal') {
    return SD_STATES.NORMAL;
  }
  if (['empty', 'none', 'nocard', 'no_card', 'notexist'].includes(status)) {
    return SD_STATES.NONE;
  }
  if (['formatting', 'format'].includes(status)) {
    return SD_STATES.FORMATTING;
  }
  return SD_STATES.ERROR;
}

const GB = 1024 ** 3;

/** Capacity and free space in GB (one decimal) of a deviceStorage answer. */
export function parseStorage(data) {
  const total = Number(data?.totalBytes);
  const used = Number(data?.usedBytes);
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const round = (bytes) => Math.round((bytes / GB) * 10) / 10;
  return {
    capacityGb: round(total),
    freeGb: round(Math.max(0, total - (Number.isFinite(used) ? used : 0))),
  };
}

/**
 * One alarm of a getAlarmMessage answer, null when unusable.
 * `picture` is the address of its picture, which Imou may encrypt.
 */
export function parseAlarm(raw) {
  const id = raw?.alarmId === undefined || raw?.alarmId === null ? '' : String(raw.alarmId);
  const seconds = Number(raw?.time);
  if (!id || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const pictures = Array.isArray(raw.picurlArray) ? raw.picurlArray : [];
  const picture = [...pictures, raw.thumbUrl].find(
    (url) => typeof url === 'string' && /^https?:\/\//.test(url),
  );
  return {
    id,
    at: seconds * 1000,
    kind: alarmKind(raw.msgType),
    msgType: String(raw.msgType ?? ''),
    code: raw.type === undefined ? '' : String(raw.type),
    picture: picture ?? null,
  };
}
