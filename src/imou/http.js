// -----------------------------------------------------------------------------
// The HTTP seam of the Imou client: one JSON POST to the Open API, one GET to
// download a picture. The tests replace both with the fake cloud
// (test/helpers/fakeCloud.js); nothing else in the code touches the network.
// -----------------------------------------------------------------------------

// The Open API answers in a second or two; a capture download from the
// picture storage can take longer on a slow line.
const API_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

// A camera picture is a few hundred kilobytes; anything far larger is not one.
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

/**
 * POST a JSON body.
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ status: number, text: string }>}
 */
async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  return { status: response.status, text: await response.text() };
}

/**
 * GET binary content (a capture or an alarm picture).
 * @param {string} url
 * @returns {Promise<{ status: number, bytes: Buffer }>}
 */
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    return { status: 413, bytes: Buffer.alloc(0) };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    bytes: bytes.length > MAX_DOWNLOAD_BYTES ? Buffer.alloc(0) : bytes,
  };
}

export const httpTransport = { post, get };
