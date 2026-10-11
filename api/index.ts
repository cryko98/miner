import type { VercelRequest, VercelResponse } from '@vercel/node';
// Relative imports carry a .js extension: the Vercel function is emitted as
// ESM without bundling, and Node's ESM loader needs explicit extensions.
import { handle } from '../server/router.js';

// Single function for every /api/* route. vercel.json rewrites
// /api/<anything> here with the sub-path in ?path=, because Vercel's own
// catch-all routing only matched single-segment paths for this project.
export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  const q = req.query.path;
  let path = Array.isArray(q) ? q.join('/') : q || '';
  if (!path) {
    const url = (req.url || '/').split('?')[0];
    path = url.replace(/^\/api\/?/, '');
    if (path === 'index') path = '';
  }
  path = path.replace(/^\/+|\/+$/g, '');
  const out = await handle({
    method: req.method || 'GET',
    path,
    body: req.body,
    headers: { authorization: req.headers.authorization },
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
