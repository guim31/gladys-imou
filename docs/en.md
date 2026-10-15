# Imou Life

Imou cameras and doorbells (Ranger, Cruiser, Bullet, Cell, Versa, doorbells…) in Gladys, through the **official
Imou Open API** (open.imoulife.com): camera images, motion and person detection, doorbell rings, privacy mode,
motion detection, floodlight, siren, pan and tilt, battery and SD card.

> **Developed without the hardware: feedback welcome.** This integration was written from the Imou documentation
> and the open-source Imou libraries, without an Imou camera nor an Imou developer account at hand. If something
> does not work with your model, please open an issue: https://github.com/guim31/gladys-imou/issues

This integration is not affiliated with Imou or Dahua.

## Requirements

- Gladys Assistant 5.1 or later (the pan/tilt arrows of the dashboard need Gladys 5.2).
- Your cameras added to the **Imou Life** app.
- A free **Imou developer account**, to get an AppId and an AppSecret:
  1. Go to [open.imoulife.com](https://open.imoulife.com) and sign up **with the same login as the Imou Life app**
     (the cameras of that account are the ones Gladys sees).
  2. Open the console, **My App** → **App Information**, click **Edit**, fill in the requested fields and save.
  3. Copy the **AppId** and the **AppSecret** shown on that page.
- Gladys needs Internet access: everything goes through the Imou cloud.

## Configuration

In Gladys, **Integrations → Imou Life → Configuration**:

| Setting                            | What it does                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| **AppId**                          | The AppId of your developer application.                                                        |
| **AppSecret**                      | Its AppSecret. It only signs the requests: never sent, never written to the logs.               |
| **Data centre**                    | Where your Imou account lives: Europe (default), Asia-Pacific, Americas or China.               |
| **Alarm check**                    | How often the alarms of each camera are read (30 seconds to 10 minutes, 1 minute by default).   |
| **Camera images**                  | How often a fresh picture of the mains-powered cameras is taken (15 minutes by default).        |
| **Allow turning surveillance off** | Lets scenes and the widget switch motion detection off or turn privacy mode on. Off by default. |
| **Allow the siren**                | Adds a siren switch to the cameras that have one. Off by default.                               |
| **Language of the names**          | Language of the feature names and of the texts sent to scenes (French by default).              |

Then **Test the connection**: it tells how many cameras Imou returned and about how many calls a day your settings
cost. The cameras appear in the **Discovery** tab: add the ones you want. Only the cameras added to Gladys are read.

## Devices

One Gladys device per camera (one per lens of a dual-lens camera or per channel of a recorder), identified by its
Imou serial number. Each camera only gets the features it has:

| Feature                | What it shows                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **Image**              | The last capture or alarm picture, shown by the camera box of the dashboard.                          |
| **Pan and tilt**       | Arrows (and zoom) of the motorized cameras: each press is one short step, the camera stops by itself. |
| **Motion**             | 1 for a minute after a detection (people included).                                                   |
| **Person**             | 1 for a minute after the camera detected a person.                                                    |
| **Doorbell ring**      | Doorbells: 1 then 0 when someone rings.                                                               |
| **Last event**         | "Person · 18:32".                                                                                     |
| **Online**             | The camera answers the Imou cloud. A battery camera asleep is online.                                 |
| **Motion detection**   | Whether motion detection is on. Read-only: see Scene actions.                                         |
| **Privacy mode**       | Whether the lens is covered. Read-only: see Scene actions.                                            |
| **Floodlight**         | The floodlight of the cameras that have one: on/off from Gladys.                                      |
| **Siren**              | Only when **Allow the siren** is ticked.                                                              |
| **Battery**            | Battery cameras, in %.                                                                                |
| **SD card**            | Normal, no card, formatting, error.                                                                   |
| **SD card size**       | In GB.                                                                                                |
| **SD card free space** | In GB (0 without a card).                                                                             |

**Motion detection** and **Privacy mode** are shown, never offered as switches: turning them off by mistake (a
voice assistant, a "turn everything off" scene) would leave the house unwatched. They change through the scene
actions and the widget.

## Refresh and quota

Gladys does not poll these cameras: the integration reads the Imou cloud on its own timers.

- The device list (one call for all cameras) every 10 minutes: names, online state.
- The alarms of each camera added to Gladys at the **Alarm check** interval: one call per camera.
- Motion detection, privacy mode and floodlight every 30 minutes, battery and SD card every hour, and right after
  a command.
- A capture of each mains-powered camera at the **Camera images** interval. Battery cameras are never woken up by
  this timer.

Every call counts in the quota of your Imou developer account. With the default settings a mains-powered camera
costs about 1,700 calls a day (1,440 of them for the alarms): lower the **Alarm check** to save calls. Imou changes
the limits of its free plan over time: check them under **My Resources** of the console. When Imou answers that
the quota is used up, every read stops for an hour and the configuration page says so.

## Widget

**Imou cameras** shows the newest picture of the chosen cameras (all by default), one line per camera (privacy
mode, last event, online, asleep or offline) and, when it shows a single camera, a **New image** button and the
privacy mode: **Resume watching** always, **Privacy mode** only when **Allow turning surveillance off** is ticked,
after a confirmation.

## Scene triggers

- **Motion detected by an Imou camera**: every detection, people included. Filters: camera, what was detected
  (motion, person). Variables: camera name, what was detected.
- **Person detected by an Imou camera**: the human detection of the camera saw someone. Variable: camera name.
- **Someone rang an Imou doorbell**: filter: doorbell. Variable: doorbell name.

The camera image is updated before the trigger fires, so "send the camera image" sends the picture of the event.
Events are read at the **Alarm check** interval: count up to that delay.

## Scene actions

- **Refresh an Imou camera image**: a capture now.
- **Turn an Imou camera**: one step left, right, up, down, zoom in or out.
- **Privacy mode of an Imou camera**: on (lens covered) or off (camera watching). On needs **Allow turning
  surveillance off**.
- **Motion detection of an Imou camera**: on or off. Off needs **Allow turning surveillance off**.

## Scene examples

- When a **Person detected by an Imou camera** comes from the driveway camera at night: turn the outdoor lights
  on and send its image by message.
- When **Someone rang an Imou doorbell**: send the doorbell image to the family and announce it on the speakers.
- When the last person leaves home: **Privacy mode of an Imou camera** off for the indoor cameras; when someone
  comes back (and surveillance may be turned off): on.

## Troubleshooting

- **"Imou refused the AppId or the AppSecret"**: copy them again from **My App**, and check the **Data centre**
  of your account.
- **No camera found**: the developer account must use the same login as the Imou Life app. Shared cameras show
  only when shared with control rights.
- **"Beyond the device limit of the free plan"**: Imou's free developer plan controls a limited number of devices.
  Keep the cameras you need on that account, or share the others to a second account with its own AppId.
- **Quota used up**: lower the **Alarm check** and the **Camera images** intervals, or add fewer cameras.
- **No image**: the camera is offline, asleep or in privacy mode. Some models encrypt their alarm pictures: the
  integration then takes a capture of mains-powered cameras instead.
- Logs: **Integrations → Imou Life → Logs**. `LOG_LEVEL=debug` shows every read. The AppSecret, the AppId, the
  tokens and the picture addresses are never written.

## Limits

- Cloud only: the Imou cloud and Internet access are needed. Imou cannot push events to Gladys (its push needs a
  public address): alarms are read every **Alarm check**, so a scene starts up to that delay after the event.
- No live video: the dashboard shows the last picture.
- Cameras of the newer Imou platform (shown as such by **Test the connection**) get the image, the alarms and the
  online state only.
- Battery cameras are not captured on a timer (each capture would wake them up) and their SD card is not read.
- The person detection, the doorbell and the abilities come from the Imou documentation, not from tests on real
  cameras: feedback welcome.
- Developed without the hardware nor an Imou account; not affiliated with Imou or Dahua.
