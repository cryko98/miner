import type { VercelRequest, VercelResponse } from '@vercel/node';
// Relative imports carry a .js extension: the Vercel function is emitted as
// ESM without bundling, and Node's ESM loader needs explicit extensions.
import { handle } from '../server/router.js';

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  // Derive the sub-path from the URL rather than the catch-all query param,
  // which is not populated consistently between `vercel dev` and production.
  const url = (req.url || '/').split('?')[0];
  const path = url.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
  const out = await handle({
    method: req.method || 'GET',
    path,
    body: req.body,
    headers: { authorization: req.headers.authorization },
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
