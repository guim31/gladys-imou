# Imou Life for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **Imou** cameras and doorbells (Ranger, Cruiser,
Bullet, Cell, Versa, doorbells…), through the **official Imou Open API**
([open.imoulife.com](https://open.imoulife.com)): camera images, motion and person detections, doorbell rings,
privacy mode, motion detection, floodlight, siren, pan/tilt/zoom, battery and SD card.

> **Developed without the hardware: feedback welcome.** No Imou camera, no Imou developer account and no network
> access to the Imou cloud were available to write this integration: it was built from the Imou libraries and
> integrations listed in the credits, and is covered by tests against a fake Imou Open API built from their
> published fixtures. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-imou/issues).
>
> This project is **not affiliated with Imou or Dahua**.

## Features

- **Cameras and doorbells** (one Gladys device each, one per lens of a dual-lens camera or per channel of a
  recorder): image (captures on a timer, the alarm picture, a fresh capture on demand), pan/tilt/zoom arrows on
  motorized cameras (the `camera/move` feature of Gladys 5.2, one bounded step per press), motion, person, doorbell
  ring, last event ("Person · 18:32"), online, motion detection and privacy mode (shown read-only), floodlight,
  siren (opt-in), battery, SD card state, size and free space.
- **Scene triggers**: _Motion detected by an Imou camera_ (filter by camera, by motion or person), _Person detected
  by an Imou camera_, _Someone rang an Imou doorbell_. The camera image is the picture of the event when the scene
  starts.
- **Scene actions**: _Refresh an Imou camera image_, _Turn an Imou camera_, _Privacy mode of an Imou camera_,
  _Motion detection of an Imou camera_.
- **Dashboard widget** _Imou cameras_: the newest picture of one, several or all cameras, one line per camera, and
  for one camera a _New image_ button and its privacy mode.
- **Safety**: turning surveillance off (motion detection off, lens covered) and the siren are off unless allowed in
  the configuration, and never exposed as switches a voice assistant could reach.
- Four languages: English, French, German, Spanish.

## Requirements

- The cameras in the **Imou Life** app, and a free **Imou developer account** created on
  [open.imoulife.com](https://open.imoulife.com) with the same login: its **AppId** and **AppSecret** (console,
  _My App_ → _App Information_). Step by step in [`docs/en.md`](docs/en.md).
- Gladys Assistant **5.1.0 or later** (5.2 for the pan/tilt arrows of the dashboard), with Internet access.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this repository:
   `https://github.com/guim31/gladys-imou` (or install **Imou Life** from the catalog once it is listed).
2. In **Configuration**, enter the AppId and the AppSecret, choose the data centre of the account (Europe by
   default), save, then click **Test the connection**.
3. Open the **Discover** tab and add the cameras you want: only those are read.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **API**: the Imou Open API, as `user2684/imouapi` and Imou's own `pyimouapi` call it: a JSON `POST` to
  `https://<data centre>/openapi/<method>`, signed with `md5("time:<t>,nonce:<n>,appSecret:<secret>")` (the secret
  never travels), a token from `accessToken` kept in `/data/imou-state.json` (mode 0600) with the data centre the
  account answers with (`currentDomain`, accepted only within Imou's domains). Methods: `listDeviceDetailsByPage`,
  `getAlarmMessage`, `getDeviceCameraStatus` / `setDeviceCameraStatus` (`closeCamera`, `motionDetect`,
  `whiteLight`), `modifyDeviceAlarmStatus`, `getDevicePowerInfo`, `deviceSdcardStatus`, `deviceStorage`,
  `setDeviceSnapEnhanced`, `controlMovePTZ` (with a duration: the camera stops by itself), `sirenStart` /
  `sirenStop`. No dependency for HTTP: the `fetch` of Node.js.
- **Refresh**: Imou can only push events to a public address, which a container behind Gladys does not have: the
  integration polls. Devices are published with `should_poll: false` and the container reads on its own timers
  (GladysAssistant/Gladys#3198): the device list (one call) every 10 minutes, the alarms of each camera added to
  Gladys every minute by default (30 s to 10 min), the switches every 30 minutes, battery and SD card every hour, a
  capture of the mains-powered cameras every 15 minutes by default — never a battery camera.
- **Quota**: every call counts against the developer account. About 1,700 calls a day per mains-powered camera with
  the defaults (1,440 for the alarms); _Test the connection_ gives the estimate for your cameras and settings. Imou
  documents its limits under _My Resources_; the HACS `imou_life` integration reported 20,000 calls a day and 5
  devices on the free plan (`FL1001` beyond), Imou's own integration a monthly allowance (`OP1013` when used up).
  On `OP1013` every read pauses for an hour; a camera answering `FL1001` is skipped until the next device list.
- **Alarms**: each new alarm message pulses the motion or person feature for a minute (the ring feature for a
  doorbell call), updates the last event, publishes its picture as the camera image — or, when Imou encrypts it
  (many models do), a fresh capture of a mains-powered camera — then fires the scene triggers. Its kind comes from
  its `msgType`, with the sets of Imou's Home Assistant integration.
- **Images**: Gladys takes 150 KB per camera image: a larger picture is decoded at a reduced size and re-encoded in
  a worker thread, in pure JavaScript (`src/jpeg-scaled.js`, [jpeg-js](https://github.com/eugeneware/jpeg-js)), as
  in guim31/gladys-unifi-protect and guim31/gladys-ezviz. In Gladys 5.2.1 the camera box of the dashboard shows the
  last image published and never asks for one: it is as fresh as the capture timer.
- **States**: `publishChangedStates`, only the changes, plus a heartbeat every 6 hours; only for the devices added
  to Gladys.
- **Logs**: the lifecycle only at info level; a repeated failure is logged once, and once when it clears;
  `LOG_LEVEL=debug` shows each alarm with its Imou type. Never the AppSecret, the AppId, a token or a picture
  address.
- **Probe**: `node scripts/probe.mjs` checks against the real Open API that a made-up AppId is refused cleanly;
  with `IMOU_APP_ID` and `IMOU_APP_SECRET` (and `IMOU_REGION`), it prints a read-only summary of an account
  (abilities, switches, alarm types, whether pictures are encrypted), serials masked.

## What could not be checked

No Imou camera, no Imou developer account and no Gladys instance were available, and the Imou cloud was not
reachable from the development environment:

- the answer of `listDeviceDetailsByPage` (no real one is published: the fixture is written from the code of
  `pyimouapi`), and the abilities each model announces;
- the `msgType` of person detection and of doorbell calls in `getAlarmMessage` on each model, and the time zone in
  which Imou reads the alarm window;
- whether the captures (`setDeviceSnapEnhanced`) of every model are plain JPEGs (the alarm pictures of many are
  encrypted), and the real size of the pictures;
- the call quotas and device licences of today's free developer plan;
- the dashboard rendering of the pan/tilt arrows (`camera/move`).

## Limitations

- Cloud only. Alarms are read at the alarm check interval (1 minute by default): a scene starts up to that delay
  after the event.
- No live video, two-way audio or recordings.
- Cameras of the newer Imou "IoT" platform get the image, the alarms and the online state only.
- Battery cameras are not captured on a timer and their SD card is not read (that would wake them up).
- No Imou plugs, bulbs, locks or alarm gateways (their accessories are left out).

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and a fake Imou Open API
npm run lint
npm run format:check
node scripts/probe.mjs   # real Open API, read-only (see above)
```

## Credits

- [user2684/imouapi](https://github.com/user2684/imouapi) and the HACS integration
  [user2684/imou_life](https://github.com/user2684/imou_life) (MIT), by user2684: the calls of the Open API, the
  ability and switch names, and the real answers of their tests used as fixtures.
- [Imou-OpenPlatform/Imou-Home-Assistant](https://github.com/Imou-OpenPlatform/Imou-Home-Assistant) and
  [pyimouapi](https://pypi.org/project/pyimouapi/) (MIT), by Imou: the data centres, the device list, the motion
  detection, siren and PTZ calls, the error codes and the alarm types.
- [guim31/gladys-ezviz](https://github.com/guim31/gladys-ezviz) and
  [guim31/gladys-unifi-protect](https://github.com/guim31/gladys-unifi-protect): the image pipeline and the
  structure of this integration.

## License

[Apache-2.0](LICENSE).
