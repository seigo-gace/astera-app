import type { D1Database } from '../part/billing-env.js';
import { createMemoryD1 } from './d1-memory.js';

/** Cloudflare D1 REST is retired; billing uses in-process memory store plus Projection API. */
export function createD1FromEnv(_env: NodeJS.ProcessEnv): D1Database {
  return createMemoryD1();
}
