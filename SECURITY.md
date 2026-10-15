# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: the AppId and AppSecret of the Imou developer application live
  in the Gladys configuration of the integration (the AppSecret in a `secret`
  field). The AppSecret is never sent anywhere: it signs each request (an MD5
  over a timestamp, a random nonce and the secret, as the Imou Open API
  specifies), and only that signature travels. Neither is written to the logs
  nor to `/data`.
- **`/data`**: one file, `imou-state.json`, mode 0600: the access token of the
  Open API, its expiry and data centre, keyed by a hash of the AppId and the
  region, and the serial numbers of the cameras seen ringing or detecting a
  person. Whoever reads this file can call the Open API for that account until
  the token expires (a few days), including the commands of the cameras.
- **Network**: the integration talks only to the Imou Open API over HTTPS
  (`*.easy4ip.com`, `*.lechange.cn`, `*.imoulife.com`, `*.imou.com`: the data
  centre the account answers with is accepted only within these domains) and
  downloads the captures and alarm pictures from the signed `https://`
  addresses the API returns. It never talks to the cameras on the local
  network, and it opens no port.
- **Camera images** stay in memory (the last one per camera, for the widget)
  and go to Gladys only. Picture addresses carry a signature: they are never
  logged.
- **Safety**: turning surveillance off (motion detection off, privacy mode on)
  and the siren are refused unless the configuration allows them, and are
  never exposed as switches a voice assistant could reach.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Imou cloud, apps, firmware and devices (report those to Imou).
