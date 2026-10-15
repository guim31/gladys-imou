// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `imou`.
//
// The use case: a glance at the wall tablet — "what did the cameras see last,
// and are they watching?". So the widget shows, for the cameras chosen in its
// settings (several, a `multi_select` of the integration's devices) or all:
//   - the newest picture (alarm or capture);
//   - a status: one row per camera — private, else its last event, else
//     online, asleep or offline;
//   - when it shows one camera: a "new image" button, and the privacy mode
//     (lens covered) — "Resume surveillance" always, "Privacy mode" only when
//     the configuration allows turning surveillance off, and after a
//     confirmation. One button per camera would not fit with several cameras:
//     the scene actions cover them.
//
// Budget (8 components, ≤ 2 texts, one focal component, one status, ≤ 4
// buttons): one caption, one image, one status, two buttons. Images: keys of
// the pictures kept by the hub (`alarm-<hash>`, `capture-<hash>`), immutable,
// served by onWidgetGetImage. Button action keys are distinct (the core drops
// a button whose action key is already used). The `primary` style does not
// show in dark mode (GladysAssistant/Gladys#3153): never used for a state.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ALARM_KINDS } from './imou/model.js';
import { ALARM_NAMES, ERROR_TEXT, formatTime, pick } from './texts.js';

export const TEXT = {
  configure: {
    en: 'Enter the AppId and AppSecret of your Imou developer application in the configuration of the integration.',
    fr: 'Saisissez l’AppId et l’AppSecret de votre application développeur Imou dans la configuration de l’intégration.',
    de: 'Gib die AppId und das AppSecret deiner Imou-Entwickleranwendung in der Konfiguration der Integration ein.',
    es: 'Introduzca el AppId y el AppSecret de su aplicación de desarrollador Imou en la configuración de la integración.',
  },
  unknown: {
    en: 'This camera is no longer in the Imou account: choose another one in the widget settings.',
    fr: 'Cette caméra n’est plus dans le compte Imou : choisissez-en une autre dans les réglages du widget.',
    de: 'Diese Kamera ist nicht mehr im Imou-Konto: Wähle eine andere in den Widget-Einstellungen.',
    es: 'Esta cámara ya no está en la cuenta Imou: elija otra en la configuración del widget.',
  },
  noImage: {
    en: 'No image yet: it comes with the first capture or alarm.',
    fr: 'Pas encore d’image : elle vient avec la première capture ou alarme.',
    de: 'Noch kein Bild: Es kommt mit der ersten Aufnahme oder dem ersten Alarm.',
    es: 'Aún no hay imagen: llega con la primera captura o alarma.',
  },
  image: { en: 'Last image', fr: 'Dernière image', de: 'Letztes Bild', es: 'Última imagen' },
  isOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  isOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  asleep: { en: 'Asleep', fr: 'En veille', de: 'Im Ruhezustand', es: 'En reposo' },
  private: { en: 'Privacy mode', fr: 'Mode privé', de: 'Privatsphäre-Modus', es: 'Modo privado' },
  refresh: { en: 'New image', fr: 'Nouvelle image', de: 'Neues Bild', es: 'Nueva imagen' },
  privacyOn: { en: 'Privacy mode', fr: 'Mode privé', de: 'Privatsphäre', es: 'Modo privado' },
  privacyOff: {
    en: 'Resume watching',
    fr: 'Reprendre',
    de: 'Fortsetzen',
    es: 'Reanudar',
  },
  watching: {
    en: 'surveillance resumed',
    fr: 'surveillance reprise',
    de: 'Überwachung fortgesetzt',
    es: 'vigilancia reanudada',
  },
  covered: {
    en: 'privacy mode on',
    fr: 'mode privé activé',
    de: 'Privatsphäre-Modus an',
    es: 'modo privado activado',
  },
  refreshed: {
    en: 'new image',
    fr: 'nouvelle image',
    de: 'neues Bild',
    es: 'nueva imagen',
  },
};

const KIND_ICONS = {
  [ALARM_KINDS.MOTION]: 'activity',
  [ALARM_KINDS.PERSON]: 'user',
  [ALARM_KINDS.DOORBELL]: 'bell',
  [ALARM_KINDS.OTHER]: 'alert-triangle',
};

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The ids of the cameras chosen in the settings. */
function chosenIds(settings) {
  const ids = Array.isArray(settings?.cameras) ? settings.cameras : [];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id))];
}

/** One status row per camera: private, else its last event, else its state. */
function cameraRow(view, camera, language) {
  const label = fit(view.nameOf(camera, language), 40);
  const alarm = view.lastAlarms.get(camera.key);
  if (camera.privacy === true) {
    return {
      label,
      icon: 'eye-off',
      value: t(TEXT.private, language),
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  if (camera.status === 'offline') {
    return {
      label,
      icon: 'video-off',
      value: t(TEXT.isOffline, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (alarm) {
    const kinds = pick(ALARM_NAMES, language);
    return {
      label,
      icon: KIND_ICONS[alarm.kind] ?? KIND_ICONS.other,
      value: fit(`${kinds[alarm.kind]} · ${formatTime(alarm.at, language, view.now)}`, 40),
      color: alarm.kind === ALARM_KINDS.OTHER ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO,
    };
  }
  if (camera.status === 'sleep') {
    return { label, icon: 'moon', value: t(TEXT.asleep, language), color: WIDGET_COLORS.NEUTRAL };
  }
  return { label, icon: 'video', value: t(TEXT.isOnline, language), color: WIDGET_COLORS.SUCCESS };
}

async function get(hub, { settings, language = 'en' }) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.configure, language);
  }
  const ids = chosenIds(settings);
  let shown = view.cameras;
  if (ids.length > 0) {
    shown = view.cameras.filter((camera) => ids.includes(view.cameraId(camera)));
    if (shown.length === 0) {
      return message(TEXT.unknown, language);
    }
  }
  const components = [];
  if (view.reachable === false && view.error) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(ERROR_TEXT[view.error.kind] ?? ERROR_TEXT.api, language), 80),
    });
  }

  // The newest picture of the cameras shown.
  const newest = shown
    .map((camera) => view.images.get(camera.key))
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)[0];
  if (newest) {
    components.push({
      type: 'image',
      key: newest.imageKey,
      alt: t(TEXT.image, language),
      fit: 'contain',
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.noImage, language) });
  }

  // The cameras, the one of the newest alarm first.
  const ordered = [...shown].sort(
    (a, b) => (view.lastAlarms.get(b.key)?.at ?? 0) - (view.lastAlarms.get(a.key)?.at ?? 0),
  );
  if (ordered.length > 0) {
    components.push({
      type: 'status',
      items: ordered.slice(0, 10).map((camera) => cameraRow(view, camera, language)),
    });
  }

  // One camera shown: a new image, and its privacy mode.
  const [only] = shown;
  if (shown.length === 1 && view.reachable !== false && only.status !== 'offline') {
    const id = view.cameraId(only);
    if (only.privacy !== true) {
      components.push({
        type: 'button',
        label: t(TEXT.refresh, language),
        icon: 'camera',
        style: 'secondary',
        action: { key: 'refresh', params: { camera: id } },
      });
    }
    if (only.privacyCapable && !only.iot) {
      if (only.privacy === true) {
        components.push({
          type: 'button',
          label: t(TEXT.privacyOff, language),
          icon: 'eye',
          style: 'secondary',
          action: { key: 'privacy_off', params: { camera: id, privacy: false } },
        });
      } else if (view.allowDisarm) {
        components.push({
          type: 'button',
          label: t(TEXT.privacyOn, language),
          icon: 'eye-off',
          style: 'secondary',
          // Turning surveillance off is asked before.
          action: { key: 'privacy_on', params: { camera: id, privacy: true }, confirm: true },
        });
      }
    }
  }
  // New alarms, captures and commands nudge the widget; the TTL is a net.
  return { ttl_seconds: 120, components };
}

/** A tap on a button: a new image, or the privacy mode. */
async function action(hub, { actionKey, params }) {
  const say = (camera, text) =>
    Object.fromEntries(
      LANGUAGES.map((language) => [
        language,
        fit(`${hub.view().nameOf(camera, language)}: ${t(text, language)}`, 200),
      ]),
    );
  if (actionKey === 'refresh') {
    await hub.refreshSnapshot(params?.camera, 'Widget');
    return say(hub.requireCamera(params?.camera), TEXT.refreshed);
  }
  const on = params?.privacy === true;
  const camera = await hub.setPrivacy(params?.camera, on, 'Widget');
  return say(camera, on ? TEXT.covered : TEXT.watching);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
