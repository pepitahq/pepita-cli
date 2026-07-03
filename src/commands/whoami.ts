import { whoami } from '../auth.js';
export async function run(): Promise<void> {
  whoami();
}
