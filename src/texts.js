// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the report of "Test the connection", scene action
// errors, trigger variables, the "last event" feature. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './imou/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object rendered by a function of the language. */
export const localized = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noAccount: {
    en: 'Enter the AppId and AppSecret of your Imou developer application in the configuration.',
    fr: 'Saisissez l’AppId et l’AppSecret de votre application développeur Imou dans la configuration.',
    de: 'Gib die AppId und das AppSecret deiner Imou-Entwickleranwendung in der Konfiguration ein.',
    es: 'Introduzca el AppId y el AppSecret de su aplicación de desarrollador Imou en la configuración.',
  },
  paused: {
    en: 'Imou says the call quota of the developer account is used up: reads paused for an hour. See "My Resources" on open.imoulife.com.',
    fr: 'Imou indique que le quota d’appels du compte développeur est épuisé : lectures en pause une heure. Voir « My Resources » sur open.imoulife.com.',
    de: 'Imou meldet, dass das Aufrufkontingent des Entwicklerkontos aufgebraucht ist: Abfragen eine Stunde pausiert. Siehe „My Resources“ auf open.imoulife.com.',
    es: 'Imou indica que la cuota de llamadas de la cuenta de desarrollador está agotada: lecturas en pausa una hora. Vea «My Resources» en open.imoulife.com.',
  },
};

// One explanation per error kind (src/imou/client.js), shown in the
// connection status, in the reports and as command errors.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The Imou cloud does not answer: check the Internet access of Gladys. Retrying.',
    fr: 'Le cloud Imou ne répond pas : vérifiez l’accès à Internet de Gladys. Nouvel essai en cours.',
    de: 'Die Imou-Cloud antwortet nicht: Prüfe den Internetzugang von Gladys. Neuer Versuch läuft.',
    es: 'La nube Imou no responde: compruebe el acceso a Internet de Gladys. Reintentando.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Imou refused the AppId or the AppSecret, or the data centre is not the account’s: correct them and save.',
    fr: 'Imou a refusé l’AppId ou l’AppSecret, ou le centre de données n’est pas celui du compte : corrigez-les puis enregistrez.',
    de: 'Imou hat die AppId oder das AppSecret abgelehnt, oder das Rechenzentrum passt nicht zum Konto: Korrigiere sie und speichere.',
    es: 'Imou ha rechazado el AppId o el AppSecret, o el centro de datos no es el de la cuenta: corríjalos y guarde.',
  },
  [ERROR_KINDS.QUOTA]: CONNECTION_TEXT.paused,
  [ERROR_KINDS.LICENSE]: {
    en: 'The free Imou developer plan controls a limited number of devices: this camera is beyond it.',
    fr: 'L’offre développeur gratuite d’Imou pilote un nombre limité d’appareils : cette caméra est au-delà.',
    de: 'Der kostenlose Imou-Entwicklertarif steuert nur eine begrenzte Zahl von Geräten: Diese Kamera liegt darüber.',
    es: 'El plan gratuito de desarrollador de Imou controla un número limitado de dispositivos: esta cámara lo supera.',
  },
  [ERROR_KINDS.NO_RIGHT]: {
    en: 'This camera is no longer on the Imou account, or shared without control rights.',
    fr: 'Cette caméra n’est plus sur le compte Imou, ou est partagée sans droit de commande.',
    de: 'Diese Kamera ist nicht mehr im Imou-Konto oder ohne Steuerungsrechte geteilt.',
    es: 'Esta cámara ya no está en la cuenta Imou, o está compartida sin permiso de control.',
  },
  [ERROR_KINDS.OFFLINE]: {
    en: 'The camera is offline: check its power and its Wi-Fi.',
    fr: 'La caméra est hors ligne : vérifiez son alimentation et son Wi-Fi.',
    de: 'Die Kamera ist offline: Prüfe ihre Stromversorgung und ihr WLAN.',
    es: 'La cámara está sin conexión: compruebe su alimentación y su wifi.',
  },
  [ERROR_KINDS.SLEEPING]: {
    en: 'The battery camera is asleep: it wakes up on motion or from the Imou app.',
    fr: 'La caméra sur batterie est en veille : elle se réveille sur un mouvement ou depuis l’app Imou.',
    de: 'Die Akkukamera schläft: Bei Bewegung oder über die Imou-App wacht sie auf.',
    es: 'La cámara de batería está en reposo: se despierta con un movimiento o desde la app Imou.',
  },
  [ERROR_KINDS.NO_STORAGE]: {
    en: 'No SD card in the camera.',
    fr: 'Pas de carte SD dans la caméra.',
    de: 'Keine SD-Karte in der Kamera.',
    es: 'No hay tarjeta SD en la cámara.',
  },
  [ERROR_KINDS.API]: {
    en: 'The Imou cloud refused the request: the integration logs give its code.',
    fr: 'Le cloud Imou a refusé la requête : les logs de l’intégration donnent son code.',
    de: 'Die Imou-Cloud hat die Anfrage abgelehnt: Die Protokolle der Integration nennen ihren Code.',
    es: 'La nube Imou ha rechazado la petición: los registros de la integración dan su código.',
  },
};

// "Test the connection": a short report, in the language of each user.
export const REPORT_TEXT = {
  en: {
    ok: (cameras, centre) => `Connected to the Imou Open API (${centre}): ${cameras} camera(s).`,
    calls: (perDay) =>
      `With these settings, about ${perDay} calls a day to Imou (check your quota under "My Resources").`,
    license: (names) => `Beyond the device limit of the free plan: ${names}.`,
    iot: (count) => `${count} camera(s) of the newer Imou platform: image, alarms and online only.`,
  },
  fr: {
    ok: (cameras, centre) => `Connecté à l’API ouverte Imou (${centre}) : ${cameras} caméra(s).`,
    calls: (perDay) =>
      `Avec ces réglages, environ ${perDay} appels par jour à Imou (vérifiez votre quota dans « My Resources »).`,
    license: (names) => `Au-delà de la limite d’appareils de l’offre gratuite : ${names}.`,
    iot: (count) =>
      `${count} caméra(s) de la nouvelle plateforme Imou : image, alarmes et état en ligne seulement.`,
  },
  de: {
    ok: (cameras, centre) => `Mit der Imou Open API verbunden (${centre}): ${cameras} Kamera(s).`,
    calls: (perDay) =>
      `Mit diesen Einstellungen etwa ${perDay} Aufrufe pro Tag an Imou (prüfe dein Kontingent unter „My Resources“).`,
    license: (names) => `Über der Gerätegrenze des kostenlosen Tarifs: ${names}.`,
    iot: (count) =>
      `${count} Kamera(s) der neueren Imou-Plattform: nur Bild, Alarme und Online-Status.`,
  },
  es: {
    ok: (cameras, centre) =>
      `Conectado a la API abierta de Imou (${centre}): ${cameras} cámara(s).`,
    calls: (perDay) =>
      `Con estos ajustes, unas ${perDay} llamadas al día a Imou (compruebe su cuota en «My Resources»).`,
    license: (names) => `Por encima del límite de dispositivos del plan gratuito: ${names}.`,
    iot: (count) =>
      `${count} cámara(s) de la nueva plataforma Imou: solo imagen, alarmas y estado en línea.`,
  },
};

// The data centres of the configuration (src/imou/client.js REGIONS).
export const REGION_NAMES = {
  en: { eu: 'Europe', sg: 'Asia-Pacific', na: 'Americas', cn: 'China' },
  fr: { eu: 'Europe', sg: 'Asie-Pacifique', na: 'Amériques', cn: 'Chine' },
  de: { eu: 'Europa', sg: 'Asien-Pazifik', na: 'Amerika', cn: 'China' },
  es: { eu: 'Europa', sg: 'Asia-Pacífico', na: 'América', cn: 'China' },
};

export const ACTION_TEXT = {
  notConfigured: CONNECTION_TEXT.noAccount,
  pickCamera: {
    en: 'Choose a camera.',
    fr: 'Choisissez une caméra.',
    de: 'Wähle eine Kamera.',
    es: 'Elija una cámara.',
  },
  unknownCamera: {
    en: 'This camera is no longer in the Imou account.',
    fr: 'Cette caméra n’est plus dans le compte Imou.',
    de: 'Diese Kamera ist nicht mehr im Imou-Konto.',
    es: 'Esta cámara ya no está en la cuenta Imou.',
  },
  snapshotFailed: {
    en: 'No image from the camera: it may be offline, asleep or in privacy mode.',
    fr: 'Pas d’image de la caméra : elle est peut-être hors ligne, en veille ou en mode privé.',
    de: 'Kein Bild von der Kamera: Vielleicht ist sie offline, im Ruhezustand oder im Privatsphäre-Modus.',
    es: 'Ninguna imagen de la cámara: quizá esté sin conexión, en reposo o en modo privado.',
  },
  notPtz: {
    en: 'This camera cannot turn in that direction.',
    fr: 'Cette caméra ne peut pas tourner dans cette direction.',
    de: 'Diese Kamera kann sich nicht in diese Richtung drehen.',
    es: 'Esta cámara no puede girar en esa dirección.',
  },
  noPrivacy: {
    en: 'This camera has no privacy mode.',
    fr: 'Cette caméra n’a pas de mode privé.',
    de: 'Diese Kamera hat keinen Privatsphäre-Modus.',
    es: 'Esta cámara no tiene modo privado.',
  },
  noDetection: {
    en: 'This camera has no motion detection switch.',
    fr: 'Cette caméra n’a pas d’interrupteur de détection de mouvement.',
    de: 'Diese Kamera hat keinen Schalter für die Bewegungserkennung.',
    es: 'Esta cámara no tiene interruptor de detección de movimiento.',
  },
  disarmNotAllowed: {
    en: 'Turning surveillance off from Gladys is not allowed: tick "Allow turning surveillance off" in the configuration.',
    fr: 'Couper la surveillance depuis Gladys n’est pas autorisé : cochez « Autoriser la coupure de la surveillance » dans la configuration.',
    de: 'Die Überwachung über Gladys abzuschalten ist nicht erlaubt: Aktiviere „Abschalten der Überwachung erlauben“ in der Konfiguration.',
    es: 'Desactivar la vigilancia desde Gladys no está permitido: marque «Permitir desactivar la vigilancia» en la configuración.',
  },
  readOnly: {
    en: 'This state is changed by the scene actions and the widget, not from here.',
    fr: 'Cet état se change par les actions de scène et le widget, pas d’ici.',
    de: 'Dieser Zustand wird über die Szenenaktionen und das Widget geändert, nicht hier.',
    es: 'Este estado se cambia con las acciones de escena y el widget, no desde aquí.',
  },
  sirenNotAllowed: {
    en: 'The siren is not allowed: tick "Allow the siren" in the configuration.',
    fr: 'La sirène n’est pas autorisée : cochez « Autoriser la sirène » dans la configuration.',
    de: 'Die Sirene ist nicht erlaubt: Aktiviere „Sirene erlauben“ in der Konfiguration.',
    es: 'La sirena no está permitida: marque «Permitir la sirena» en la configuración.',
  },
};

// Kinds of alarm (src/imou/model.js ALARM_KINDS), as Gladys shows them.
export const ALARM_NAMES = {
  en: { motion: 'Motion', person: 'Person', doorbell: 'Doorbell', other: 'Alarm' },
  fr: { motion: 'Mouvement', person: 'Personne', doorbell: 'Sonnette', other: 'Alarme' },
  de: { motion: 'Bewegung', person: 'Person', doorbell: 'Türklingel', other: 'Alarm' },
  es: { motion: 'Movimiento', person: 'Persona', doorbell: 'Timbre', other: 'Alarma' },
};

// State of the SD card (src/imou/model.js SD_STATES).
export const SD_STATE_NAMES = {
  en: { normal: 'Normal', none: 'No card', formatting: 'Formatting', error: 'Error' },
  fr: {
    normal: 'Normale',
    none: 'Pas de carte',
    formatting: 'Formatage en cours',
    error: 'Erreur',
  },
  de: { normal: 'Normal', none: 'Keine Karte', formatting: 'Wird formatiert', error: 'Fehler' },
  es: { normal: 'Normal', none: 'Sin tarjeta', formatting: 'Formateando', error: 'Error' },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * "14/10 18:32" in the time zone of Gladys (the supervisor sets TZ), or
 * "18:32" for today.
 */
export function formatTime(at, language, now = Date.now()) {
  const locale = LOCALES[language] ?? LOCALES.en;
  const date = new Date(at);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const day = (value) =>
    new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(value));
  return day(at) === day(now) ? time : `${day(at)} ${time}`;
}

/** "Person · 18:32": the text of the "last event" feature. */
export function eventText(alarm, language, now) {
  const names = pick(ALARM_NAMES, language);
  return `${names[alarm.kind] ?? names.other} · ${formatTime(alarm.at, language, now)}`;
}
