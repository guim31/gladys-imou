// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container),
// in /data/imou-state.json, mode 0600:
//   - token: the access token of the Imou Open API, its expiry and the data
//     centre of the account, so a restart does not ask for a new one. Keyed
//     by a hash of the AppId and region: another application starts over;
//   - persons, doorbells: the cameras seen detecting a person or ringing,
//     whose abilities did not say so, so they keep that feature after a
//     restart.
// The AppSecret stays in the Gladys configuration, never here.
// (Adapted from guim31/gladys-ezviz.)
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'imou-store' });
const FILE_NAME = 'imou-state.json';

export class Store {
  constructor(directory = process.env.IMOU_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.data = {};
    this.pending = null;
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      this.data = {};
    }
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (value === undefined || value === null) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    return this.save();
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save() {
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        this.pending = null;
        const snapshot = JSON.stringify(this.data);
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
