import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['index.html', 'style.css', 'simple.css', 'chat.css', 'chat-v2.css', 'chat-v3.css', 'chat-app.js', 'aurora.js', 'chat-store.js', 'image-settings.js', 'api-client.js', 'backup.js', 'rayai-config.js', 'rayai-icon.png', 'favicon.ico', 'THIRD_PARTY_NOTICES.md'];
const assets = {};
for (const name of files) {
  const binary = name.endsWith('.png') || name.endsWith('.ico');
  const data = await readFile(resolve(root, name));
  assets[`/${name}`] = {
    type: name.endsWith('.png') ? 'image/png' : name.endsWith('.ico') ? 'image/x-icon' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    body: binary ? data.toString('base64') : data.toString('utf8'),
    base64: binary,
  };
}
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'worker/entry.js')],
  outfile: resolve(root, 'dist/server/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  plugins: [{
    name: 'site-assets',
    setup(plugin) {
      plugin.onResolve({ filter: /^virtual:site-assets$/ }, () => ({ path: 'site-assets', namespace: 'site-assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'site-assets' }, () => ({ contents: `export default ${JSON.stringify(assets)};`, loader: 'js' }));
    },
  }],
});
