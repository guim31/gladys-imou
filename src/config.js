// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Imou developer application per installation: its AppId and AppSecret
// (open.imoulife.com, free), the data centre of the account, the pace of the
// cloud reads, two safety switches and the language of the names.
// -----------------------------------------------------------------------------

import { REGIONS } from './imou/client.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const REGION_KEYS = Object.keys(REGIONS);

// Seconds between two alarm reads. Imou has no event stream a container
// behind Gladys can receive (its push needs a public address), and every read
// is one call per camera against the quota of the developer account: one
// minute by default, faster at the user's choice.
export const ALARM_INTERVALS = ['30', '60', '120', '300', '600'];

// Minutes between two fresh captures of the mains-powered cameras added to
// Gladys (`0`: only on an alarm or a scene action). The camera box of the
// dashboard shows the last image the integration published and never asks
// for one (Gladys 5.2.1), so this is how fresh it is. Battery cameras are
// never woken up by the timer.
export const SNAPSHOT_INTERVALS = ['0', '5', '15', '60'];

export const DEFAULT_CONFIG = {
  app_id: '',
  app_secret: '',
  region: 'eu',
  alarm_interval: '60',
  snapshot_interval: '15',
  allow_disarm: false,
  allow_siren: false,
  language: 'fr',
};

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const region = pickOption(text('region'), REGION_KEYS, DEFAULT_CONFIG.region);
  const language = text('language');
  return {
    appId: text('app_id'),
    // Pasted secrets often carry a stray space or new line: never part of one.
    appSecret: text('app_secret'),
    region,
    host: REGIONS[region],
    alarmIntervalMs:
      Number(pickOption(source.alarm_interval, ALARM_INTERVALS, DEFAULT_CONFIG.alarm_interval)) *
      1000,
    snapshotIntervalMs:
      Number(
        pickOption(source.snapshot_interval, SNAPSHOT_INTERVALS, DEFAULT_CONFIG.snapshot_interval),
      ) * 60_000,
    allowDisarm: flag(source.allow_disarm, DEFAULT_CONFIG.allow_disarm),
    allowSiren: flag(source.allow_siren, DEFAULT_CONFIG.allow_siren),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}
