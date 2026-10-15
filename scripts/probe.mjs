#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Imou Open API, with the client of the integration
// (src/imou/client.js). Read-only: it asks for a token and reads; it never
// sends a command. Nothing sensitive is printed: no AppId, no AppSecret, no
// token, no serial number in clear (masked), no picture address.
//
// Without an application (default): asks a token for a made-up AppId and
// checks that Imou refuses it cleanly (an Imou error code, no crash):
//
//   node scripts/probe.mjs
//
// With an application (environment variables, never arguments, so they stay
// out of the shell history):
//
//   IMOU_APP_ID=… IMOU_APP_SECRET=… [IMOU_REGION=eu|sg|na|cn] node scripts/probe.mjs
//
// it lists the cameras (model, status, the abilities the integration uses),
// reads for each one the online state, the switches, battery and SD card, and
// the type of its last alarms — what the integration needs to classify them —
// and says whether the last alarm picture is a plain JPEG or encrypted.
// IMOU_CAPTURE=1 also takes one capture of the first camera online (one
// picture, like the Imou app does) to check it is a plain JPEG.
// Exit code 0 when the probe behaved as expected, 1 otherwise.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { ERROR_KINDS, ImouClient, REGIONS } from '../src/imou/client.js';
import {
  SWITCH_TYPES,
  parseAlarm,
  parseBattery,
  parseDeviceList,
  parseOnline,
  parseSdState,
  parseStorage,
  parseSwitch,
} from '../src/imou/model.js';
import { isJpeg } from '../src/image.js';

const mask = (serial) => `${String(serial).slice(0, 2)}…${String(serial).slice(-2)}`;
const say = (line = '') => process.stdout.write(`${line}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A read that may fail: its result, or the Imou code of its failure. */
async function attempt(run) {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: `${err.kind}${err.code ? ` (${err.code})` : ''}` };
  }
}

async function refusal() {
  const region = process.env.IMOU_REGION in REGIONS ? process.env.IMOU_REGION : 'eu';
  const client = new ImouClient({
    appId: `lc${randomBytes(8).toString('hex')}`,
    appSecret: randomBytes(16).toString('hex'),
    host: REGIONS[region],
  });
  say(`Token for a made-up AppId on ${REGIONS[region]}…`);
  try {
    await client.ensureToken();
  } catch (err) {
    say(`Refused: kind "${err.kind}", Imou code ${err.code ?? '-'} — ${err.message}`);
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.API) {
      say('OK: Imou refuses an unknown application cleanly.');
      return 0;
    }
    say('UNEXPECTED: the Open API did not answer as expected (network, proxy?).');
    return 1;
  }
  say('UNEXPECTED: a made-up AppId got a token.');
  return 1;
}

async function account() {
  const region = process.env.IMOU_REGION ?? 'eu';
  if (!(region in REGIONS)) {
    say(`IMOU_REGION must be one of ${Object.keys(REGIONS).join(', ')}.`);
    return 1;
  }
  const client = new ImouClient({
    appId: process.env.IMOU_APP_ID.trim(),
    appSecret: (process.env.IMOU_APP_SECRET ?? '').trim(),
    host: REGIONS[region],
  });
  try {
    await client.ensureToken();
  } catch (err) {
    say(`Token refused: kind "${err.kind}", Imou code ${err.code ?? '-'}`);
    return 1;
  }
  const days = Math.round((client.token.expiresAt - Date.now()) / 86_400_000);
  say(`Token received, valid about ${days} day(s); data centre ${client.host}.`);

  let raw;
  try {
    raw = await client.listDevices();
  } catch (err) {
    say(`Device list refused: kind "${err.kind}", Imou code ${err.code ?? '-'}`);
    return 1;
  }
  say(
    `${raw.length} device(s) listed; fields of the first: ${Object.keys(raw[0] ?? {}).join(', ')}`,
  );
  const cameras = parseDeviceList(raw);
  say(`${cameras.length} camera(s):`);
  let captured = process.env.IMOU_CAPTURE !== '1';
  for (const camera of cameras) {
    const has = Object.entries(camera)
      .filter(([key, value]) => key.endsWith('Capable') && value)
      .map(([key]) => key.replace('Capable', ''));
    say('');
    say(
      `- ${mask(camera.key)} ${camera.model || '?'} ch${camera.channelId}: ${camera.status}` +
        `${camera.iot ? ', IoT platform' : ''}, ptz ${camera.ptz ?? 'no'}` +
        `${camera.batteryPowered ? ', battery' : ''}${camera.doorbell ? ', doorbell' : ''}` +
        `, has: ${has.join(' ') || '-'}`,
    );
    const online = await attempt(() => client.online(camera.deviceId));
    say(
      `  deviceOnline: ${online.ok ? parseOnline(online.value, camera.channelId) : online.error}`,
    );
    if (!camera.iot && camera.status === 'online') {
      for (const [field, types] of Object.entries(SWITCH_TYPES)) {
        for (const type of types) {
          const read = await attempt(() =>
            client.switchStatus(camera.deviceId, camera.channelId, type),
          );
          say(`  ${field} (${type}): ${read.ok ? parseSwitch(read.value) : read.error}`);
        }
      }
      if (camera.sdCapable) {
        const sd = await attempt(() => client.sdCardStatus(camera.deviceId));
        const storage = await attempt(() => client.storage(camera.deviceId));
        say(
          `  SD card: ${sd.ok ? parseSdState(sd.value) : sd.error}, ` +
            `${storage.ok ? JSON.stringify(parseStorage(storage.value)) : storage.error}`,
        );
      }
    }
    if (camera.batteryPowered) {
      const power = await attempt(() => client.power(camera.deviceId));
      say(`  battery: ${power.ok ? parseBattery(power.value) : power.error}`);
    }
    const alarms = await attempt(() =>
      client.alarms(camera.deviceId, camera.channelId, Date.now() - 7 * 86_400_000),
    );
    if (!alarms.ok) {
      say(`  alarms: ${alarms.error}`);
    } else {
      const parsed = alarms.value.map(parseAlarm).filter(Boolean);
      const types = parsed.map((alarm) => `${alarm.msgType}/${alarm.code}→${alarm.kind}`);
      say(`  last alarms (7 days): ${types.join(', ') || 'none'}`);
      if (parsed[0]?.picture) {
        const picture = await attempt(() => client.download(parsed[0].picture));
        say(
          `  last alarm picture: ${
            picture.ok
              ? isJpeg(picture.value)
                ? `plain JPEG, ${picture.value.length} bytes`
                : 'not a JPEG (encrypted)'
              : picture.error
          }`,
        );
      }
    }
    if (!captured && camera.status === 'online' && !camera.batteryPowered) {
      captured = true;
      const url = await attempt(() => client.snapshot(camera.deviceId, camera.channelId));
      if (url.ok) {
        await delay(2000);
        const bytes = await attempt(() => client.download(url.value));
        say(
          `  capture: ${
            bytes.ok
              ? isJpeg(bytes.value)
                ? `plain JPEG, ${bytes.value.length} bytes`
                : 'not a JPEG (encrypted)'
              : bytes.error
          }`,
        );
      } else {
        say(`  capture: ${url.error}`);
      }
    }
  }
  say('');
  say(`${client.calls} call(s) to the Open API.`);
  return 0;
}

const run = process.env.IMOU_APP_ID ? account : refusal;
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    say(`Probe failed: ${err.message}`);
    process.exit(1);
  });
