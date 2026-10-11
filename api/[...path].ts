import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handle } from '../server/router';

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.query.path;
  const path = (Array.isArray(raw) ? raw.join('/') : raw || '').replace(/^\/+|\/+$/g, '');
  const out = await handle({
    method: req.method || 'GET',
    path,
    body: req.body,
    headers: { authorization: req.headers.authorization },
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
