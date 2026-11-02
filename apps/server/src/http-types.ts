import type { Identity } from '@praxis/auth';
import type { Hono } from 'hono';
export type HttpApp = Hono<{ Variables: { identity: Identity } }>;
