import { defineConfig, type Plugin } from 'vite';

// Serves /api/* from the same router the Vercel function uses, so `npm run dev`
// gives a working backend (in-memory store unless Redis env vars are set).
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          const { handle } = await server.ssrLoadModule('/server/router.ts');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          let body: unknown = undefined;
          if (chunks.length) {
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              body = undefined;
            }
          }
          const path = (req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '');
          const out = await handle({
            method: req.method || 'GET',
            path,
            body,
            headers: { authorization: req.headers.authorization },
          });
          res.statusCode = out.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(out.body));
        } catch (e) {
          // Aborted sockets and handler crashes must never take the dev server down.
          if (!res.headersSent && !res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
  build: { target: 'es2020' },
});
