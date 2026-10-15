// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - refresh_snapshot: a fresh picture of a camera, sent to Gladys, so the
//     next action ("send the camera image" in a message) sends what the
//     camera sees now;
//   - move_camera: one bounded step of a motorized camera (the camera stops
//     by itself: never a move left running);
//   - set_privacy_mode: cover the lens or uncover it ("I am home: indoor
//     cameras private");
//   - set_motion_detection: motion detection on or off.
// Covering the lens and switching detection off turn surveillance off: they
// need "Allow turning surveillance off" in the configuration (src/hub.js).
// Gladys applies the field defaults to scene actions; a failure throws, the
// scene logs it and carries on.
// -----------------------------------------------------------------------------

import { MOVES } from './devices.js';

// Options of the `direction` and `state` fields: permanent once published.
export const DIRECTIONS = Object.values(MOVES);
export const STATES = ['on', 'off'];

const state = (fields) => {
  const value = String(fields.state ?? '');
  if (!STATES.includes(value)) {
    throw new Error(`Unknown state ${value}`);
  }
  return value === 'on';
};

export const SCENE_ACTIONS = {
  async refresh_snapshot(hub, { fields = {} }) {
    await hub.refreshSnapshot(fields.camera, 'Scene action');
  },

  async move_camera(hub, { fields = {} }) {
    await hub.moveCamera(fields.camera, String(fields.direction ?? ''));
  },

  async set_privacy_mode(hub, { fields = {} }) {
    await hub.setPrivacy(fields.camera, state(fields), 'Scene action');
  },

  async set_motion_detection(hub, { fields = {} }) {
    await hub.setDetection(fields.camera, state(fields), 'Scene action');
  },
};
