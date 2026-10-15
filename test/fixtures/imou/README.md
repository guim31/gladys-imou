# Imou Open API fixtures

- `responses.json`: real answers of the Imou Open API published in the tests of
  [user2684/imouapi](https://github.com/user2684/imouapi) (`tests/const.py`, MIT
  licence): access token, wrong AppId, expired token, online state, switch,
  storage, SD card, PTZ, capture, battery. Serial numbers, tokens and picture
  addresses are replaced by made-up ones (`FAKE…`, `pictures.imou.test`).
- `alarms.json`: the `getAlarmMessage` answer of the same tests (two `human`
  alarms), anonymized the same way.
- `devices.json`: a `listDeviceDetailsByPage` answer **written from the code**
  of [Imou-OpenPlatform/pyimouapi](https://pypi.org/project/pyimouapi/)
  (`device.py`, MIT licence), which reads `deviceId`, `deviceName`,
  `deviceStatus`, `deviceModel`, `deviceAbility`, `deviceVersion`,
  `channelNum`, `productId` and `channelList` (`channelId`, `channelName`,
  `channelStatus`, `channelAbility`). No real answer of this call is
  published. The ability list of the first cameras is the real one of an
  IPC-C22C (imouapi tests); the others are built from the ability names of
  the Imou documentation (pan/tilt, floodlight, battery, doorbell, a dual-lens
  camera, a device of the newer "IoT" platform, a gateway accessory without
  channel). Probe a real account with `scripts/probe.mjs` to check them.
