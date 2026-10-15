// -----------------------------------------------------------------------------
// The configuration as the code reads it: defaults, trimmed credentials,
// data centres, intervals and the two safety switches.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('an empty configuration gives the defaults, safe ones', () => {
  assert.deepEqual(normalizeConfig({}), {
    appId: '',
    appSecret: '',
    region: 'eu',
    host: 'openapi-fk.easy4ip.com',
    alarmIntervalMs: 60_000,
    snapshotIntervalMs: 15 * 60_000,
    allowDisarm: false,
    allowSiren: false,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig(undefined));
});

test('credentials are trimmed, regions and intervals checked', () => {
  const config = normalizeConfig({
    app_id: ' lcabc \n',
    app_secret: '\tsecret ',
    region: 'na',
    alarm_interval: '300',
    snapshot_interval: '0',
    allow_disarm: 'true',
    allow_siren: true,
    language: 'de',
  });
  assert.equal(config.appId, 'lcabc');
  assert.equal(config.appSecret, 'secret');
  assert.equal(config.host, 'openapi-or.easy4ip.com');
  assert.equal(config.alarmIntervalMs, 300_000);
  assert.equal(config.snapshotIntervalMs, 0);
  assert.equal(config.allowDisarm, true);
  assert.equal(config.allowSiren, true);
  assert.equal(config.language, 'de');
  const odd = normalizeConfig({ region: 'mars', alarm_interval: '1', language: 'it' });
  assert.equal(odd.region, 'eu');
  assert.equal(odd.alarmIntervalMs, 60_000);
  assert.equal(odd.language, 'fr');
});
