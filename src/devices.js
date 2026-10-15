// -----------------------------------------------------------------------------
// The Gladys devices: one per Imou camera (one per channel of a recorder or a
// multi-lens camera).
//
// Identity: the serial number Imou gives the device (`deviceId`), plus
// `-ch<n>` when it has several channels — `gladys.externalIds('camera', key)`.
// Never a name. Feature keys are permanent once published
// (test/gladys-rules.test.js checks the couples against the core table).
//
// Features, each one only when the camera has it:
//   image        camera/image          captures and alarm pictures
//   move         camera/move           pan/tilt (and zoom) models, one bounded step
//   motion       motion-sensor/binary  1 for a minute after a detection
//   person       motion-sensor/binary  1 for a minute after a person was detected
//   ring         doorbell/ring         doorbells: 1 → 0 pulse, as the core expects
//   last_event   text/text             "Person · 18:32"
//   online       input/binary          shown On/Off (a sleeping battery camera is online)
//   detection    switch/binary         motion detection, READ-ONLY (see below)
//   privacy      switch/binary         privacy mode (lens covered), READ-ONLY
//   light        light/binary          floodlight
//   siren        siren/binary          only when allowed in the configuration
//   battery      battery/integer       battery models
//   sd_state     text/text             SD card: normal, no card, error…
//   sd_capacity  data/size (GB)        SD card size
//   sd_free      data/size (GB)        free space on the SD card
//
// Safety: switching motion detection off or covering the lens disarms the
// camera. Neither is a command a voice assistant or a "turn everything off"
// could reach: both features only show the state, and the change goes through
// the scene actions and the widget, the disarming direction only when the
// configuration allows it (src/hub.js).
//
// Devices are published with should_poll: false: the integration reads the
// cloud on its own timers (src/hub.js), never waiting for Gladys to poll
// (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SD_STATE_NAMES, pick } from './texts.js';

export const CAMERA_TYPE = 'camera';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  IMAGE: 'image',
  MOVE: 'move',
  MOTION: 'motion',
  PERSON: 'person',
  RING: 'ring',
  LAST_EVENT: 'last_event',
  ONLINE: 'online',
  DETECTION: 'detection',
  PRIVACY: 'privacy',
  LIGHT: 'light',
  SIREN: 'siren',
  BATTERY: 'battery',
  SD_STATE: 'sd_state',
  SD_CAPACITY: 'sd_capacity',
  SD_FREE: 'sd_free',
});

// Values of camera/move (the core's CAMERA_MOVE) → the PTZ operation of Imou.
// 0 (stop) is always accepted and never listed as an option.
export const MOVES = Object.freeze({
  1: 'left',
  2: 'right',
  3: 'up',
  4: 'down',
  5: 'zoom_in',
  6: 'zoom_out',
});

// The movements each kind of motorized camera supports (src/imou/model.js).
export const MOVES_BY_PTZ = Object.freeze({
  ptz: [1, 2, 3, 4, 5, 6],
  pt: [1, 2, 3, 4],
  pan: [1, 2],
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    image: 'Image',
    move: 'Pan and tilt',
    motion: 'Motion',
    person: 'Person',
    ring: 'Doorbell ring',
    last_event: 'Last event',
    online: 'Online',
    detection: 'Motion detection',
    privacy: 'Privacy mode',
    light: 'Floodlight',
    siren: 'Siren',
    battery: 'Battery',
    sd_state: 'SD card',
    sd_capacity: 'SD card size',
    sd_free: 'SD card free space',
  },
  fr: {
    image: 'Image',
    move: 'Orientation',
    motion: 'Mouvement',
    person: 'Personne',
    ring: 'Sonnette',
    last_event: 'Dernier événement',
    online: 'En ligne',
    detection: 'Détection de mouvement',
    privacy: 'Mode privé',
    light: 'Projecteur',
    siren: 'Sirène',
    battery: 'Batterie',
    sd_state: 'Carte SD',
    sd_capacity: 'Taille de la carte SD',
    sd_free: 'Espace libre de la carte SD',
  },
  de: {
    image: 'Bild',
    move: 'Schwenken und Neigen',
    motion: 'Bewegung',
    person: 'Person',
    ring: 'Türklingel',
    last_event: 'Letztes Ereignis',
    online: 'Online',
    detection: 'Bewegungserkennung',
    privacy: 'Privatsphäre-Modus',
    light: 'Flutlicht',
    siren: 'Sirene',
    battery: 'Batterie',
    sd_state: 'SD-Karte',
    sd_capacity: 'Größe der SD-Karte',
    sd_free: 'Freier Platz der SD-Karte',
  },
  es: {
    image: 'Imagen',
    move: 'Orientación',
    motion: 'Movimiento',
    person: 'Persona',
    ring: 'Timbre',
    last_event: 'Último evento',
    online: 'En línea',
    detection: 'Detección de movimiento',
    privacy: 'Modo privado',
    light: 'Foco',
    siren: 'Sirena',
    battery: 'Batería',
    sd_state: 'Tarjeta SD',
    sd_capacity: 'Tamaño de la tarjeta SD',
    sd_free: 'Espacio libre de la tarjeta SD',
  },
};

// Name of a camera Imou did not name.
export const DEVICE_NAMES = {
  en: { camera: 'Imou camera' },
  fr: { camera: 'Caméra Imou' },
  de: { camera: 'Imou-Kamera' },
  es: { camera: 'Cámara Imou' },
};

// Movements of camera/move, as the arrows of the dashboard read them.
export const MOVE_NAMES = {
  en: { 1: 'Left', 2: 'Right', 3: 'Up', 4: 'Down', 5: 'Zoom in', 6: 'Zoom out' },
  fr: { 1: 'Gauche', 2: 'Droite', 3: 'Haut', 4: 'Bas', 5: 'Zoom avant', 6: 'Zoom arrière' },
  de: { 1: 'Links', 2: 'Rechts', 3: 'Hoch', 4: 'Runter', 5: 'Hineinzoomen', 6: 'Herauszoomen' },
  es: { 1: 'Izquierda', 2: 'Derecha', 3: 'Arriba', 4: 'Abajo', 5: 'Acercar', 6: 'Alejar' },
};

const sensor = (category, type = DEVICE_FEATURE_TYPES.SENSOR.BINARY, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const command = (category, type) => ({
  category,
  type,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
});

// Text features have no bounds, but min/max are NOT NULL in Gladys.
const text = () => ({
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 0,
});

const size = () =>
  sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
    unit: DEVICE_FEATURE_UNITS.GIGABYTE,
    max: 2048,
  });

const DEFINITIONS = {
  [FEATURE_KEYS.IMAGE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
    read_only: true,
    has_feedback: false,
    // Images travel on their own channel, never in the states history.
    keep_history: false,
    min: 0,
    max: 0,
  },
  [FEATURE_KEYS.MOVE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
    read_only: false,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 6,
  },
  [FEATURE_KEYS.MOTION]: sensor(DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR),
  [FEATURE_KEYS.PERSON]: sensor(DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR),
  [FEATURE_KEYS.RING]: sensor(
    DEVICE_FEATURE_CATEGORIES.DOORBELL,
    DEVICE_FEATURE_TYPES.DOORBELL.RING,
  ),
  [FEATURE_KEYS.LAST_EVENT]: text(),
  [FEATURE_KEYS.ONLINE]: sensor(DEVICE_FEATURE_CATEGORIES.INPUT),
  // Read-only on purpose: see the header.
  [FEATURE_KEYS.DETECTION]: sensor(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.PRIVACY]: sensor(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.LIGHT]: command(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BINARY),
  [FEATURE_KEYS.SIREN]: command(DEVICE_FEATURE_CATEGORIES.SIREN, DEVICE_FEATURE_TYPES.SIREN.BINARY),
  [FEATURE_KEYS.BATTERY]: sensor(
    DEVICE_FEATURE_CATEGORIES.BATTERY,
    DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    { unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 },
  ),
  [FEATURE_KEYS.SD_STATE]: text(),
  [FEATURE_KEYS.SD_CAPACITY]: size(),
  [FEATURE_KEYS.SD_FREE]: size(),
};

/** External ids of a camera and its features. */
export const cameraIds = (gladys, key) => gladys.externalIds(CAMERA_TYPE, key);

/**
 * The feature keys of a camera, in display order.
 * @param {object} camera a parsed camera (src/imou/model.js)
 * @param {object} [options]
 * @param {boolean} [options.person] the camera was seen detecting a person
 * @param {boolean} [options.doorbell] the camera was seen ringing
 * @param {boolean} [options.allowSiren] the siren may be driven from Gladys
 */
export function featureKeys(camera, { person = false, doorbell = false, allowSiren = false } = {}) {
  // An "IoT platform" device answers other calls than these switches and
  // readings: the image, the alarms and the online state only.
  const full = !camera.iot;
  return [
    FEATURE_KEYS.IMAGE,
    full && camera.ptz && FEATURE_KEYS.MOVE,
    FEATURE_KEYS.MOTION,
    (camera.personCapable || person) && FEATURE_KEYS.PERSON,
    (camera.doorbell || doorbell) && FEATURE_KEYS.RING,
    FEATURE_KEYS.LAST_EVENT,
    FEATURE_KEYS.ONLINE,
    full && camera.detectionCapable && FEATURE_KEYS.DETECTION,
    full && camera.privacyCapable && FEATURE_KEYS.PRIVACY,
    full && camera.lightCapable && FEATURE_KEYS.LIGHT,
    full && camera.sirenCapable && allowSiren && FEATURE_KEYS.SIREN,
    full && camera.batteryPowered && FEATURE_KEYS.BATTERY,
    // A sleeping battery camera would have to be woken up to read its card.
    full && camera.sdCapable && !camera.dormant && FEATURE_KEYS.SD_STATE,
    full && camera.sdCapable && !camera.dormant && FEATURE_KEYS.SD_CAPACITY,
    full && camera.sdCapable && !camera.dormant && FEATURE_KEYS.SD_FREE,
  ].filter(Boolean);
}

/** The name shown for a camera: the account's, else "Imou camera" and its serial end. */
export function cameraName(camera, language = 'en') {
  if (camera.name) {
    return camera.name;
  }
  return `${pick(DEVICE_NAMES, language).camera} ${String(camera.key).slice(-6)}`;
}

/**
 * The discovery payload of a camera.
 * @param {object} gladys SDK client
 * @param {object} camera a parsed camera
 * @param {object} [options] language, person, doorbell, allowSiren
 */
export function buildCamera(gladys, camera, { language = 'en', ...options } = {}) {
  const ids = cameraIds(gladys, camera.key);
  const names = pick(NAMES, language);
  const moves = pick(MOVE_NAMES, language);
  return {
    name: cameraName(camera, language),
    external_id: ids.device,
    model: camera.model ? `Imou ${camera.model}` : 'Imou',
    should_poll: false,
    features: featureKeys(camera, options).map((key) => ({
      ...DEFINITIONS[key],
      name: names[key],
      external_id: ids.feature(key),
      ...(key === FEATURE_KEYS.MOVE
        ? {
            supported_options: MOVES_BY_PTZ[camera.ptz].map((value, index) => ({
              value,
              label: moves[value],
              sort_order: index,
            })),
          }
        : {}),
    })),
  };
}

const flag = (value) => (value ? 1 : 0);
const known = (value) => (value === null || value === undefined ? null : flag(value));

/**
 * The value of every feature of a camera (null or undefined: nothing to
 * publish). Text values are `{ text }`.
 * @param {object} camera a parsed camera
 * @param {object} live { motion, person, ring, siren, lastEvent: string|null }
 * @param {string} language
 */
export function featureValues(camera, live = {}, language = 'en') {
  const sdNames = pick(SD_STATE_NAMES, language);
  return {
    [FEATURE_KEYS.MOTION]: flag(live.motion),
    [FEATURE_KEYS.PERSON]: flag(live.person),
    [FEATURE_KEYS.RING]: flag(live.ring),
    [FEATURE_KEYS.LAST_EVENT]: live.lastEvent ? { text: live.lastEvent } : null,
    // A battery camera asleep still answers the cloud: online.
    [FEATURE_KEYS.ONLINE]: flag(camera.status !== 'offline'),
    [FEATURE_KEYS.DETECTION]: known(camera.detection),
    [FEATURE_KEYS.PRIVACY]: known(camera.privacy),
    [FEATURE_KEYS.LIGHT]: known(camera.light),
    [FEATURE_KEYS.SIREN]: flag(live.siren),
    [FEATURE_KEYS.BATTERY]: camera.battery,
    [FEATURE_KEYS.SD_STATE]: camera.sd ? { text: sdNames[camera.sd.state] } : null,
    [FEATURE_KEYS.SD_CAPACITY]: camera.sd?.capacityGb ?? null,
    [FEATURE_KEYS.SD_FREE]: camera.sd?.freeGb ?? null,
  };
}
