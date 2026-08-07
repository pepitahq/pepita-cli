/**
 * This binary's own version, at runtime.
 *
 * Hand-maintained rather than imported from package.json: the CLI is bundled,
 * and pulling JSON into the bundle for one string costs more than a constant
 * plus the test that keeps it honest (`tests/version.test.ts` asserts the two
 * agree, so drift fails the suite rather than shipping).
 *
 * It reaches the server as `X-Pepita-Client: cli/<version>`, which is how a
 * published binary older than the API gets told to upgrade. Bump it with
 * package.json, in the same commit.
 */
export const VERSION = '0.19.0';

/** What we send as `X-Pepita-Client`. */
export const CLIENT_ID = `cli/${VERSION}`;
