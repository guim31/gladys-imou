# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Imou cameras and doorbells in Gladys through the official Imou Open API
  (AppId and AppSecret of a free developer account, data centre Europe,
  Asia-Pacific, Americas or China): one device per camera, per lens of a
  dual-lens camera or per channel of a recorder.
- Camera image: captures of the mains-powered cameras on a timer (15 minutes
  by default), the alarm picture (or a capture when Imou encrypts it), a fresh
  capture for the "send the camera image" scene action.
- Motion, person and doorbell ring from the alarm messages, read every minute
  by default; the last event ("Person · 18:32"); online state; battery; SD
  card state, size and free space.
- Floodlight on/off, pan/tilt (and zoom) by the camera "move" feature, one
  bounded step per press; siren only when allowed in the configuration.
- Motion detection and privacy mode shown read-only; changed by the scene
  actions and the widget, the direction that turns surveillance off only when
  "Allow turning surveillance off" is ticked.
- Scene triggers: motion detected, person detected, someone rang a doorbell.
- Scene actions: refresh a camera image, turn a camera, privacy mode, motion
  detection.
- Dashboard widget "Imou cameras": newest picture, one line per camera, new
  image and privacy mode buttons.
- "Test the connection" action, with the number of cameras and an estimate of
  the daily calls the settings cost against the Imou quota; reads pause for an
  hour when Imou says the quota is used up.
- Feature names, messages, manifest and documentation in English, French,
  German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-imou/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-imou/releases/tag/v1.0.1
