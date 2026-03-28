import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = __dirname;
const port = Number(process.env.PORT ?? 5173);

const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

function safeJoin(rootDir, urlPath) {
    const clean = urlPath.split('?')[0].split('#')[0];
    const decoded = decodeURIComponent(clean);
    const joined = path.join(rootDir, decoded);
    const normalized = path.normalize(joined);
    if (!normalized.startsWith(path.normalize(rootDir))) throw new Error('Path traversal');
    return normalized;
}

const server = http.createServer(async (req, res) => {
    try {
        const url = req.url ?? '/';
        const reqPath = url === '/' ? '/index.html' : url;
        const filePath = safeJoin(root, reqPath);

        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) {
            res.statusCode = 404;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('Not found');
            return;
        }

        let finalPath = filePath;
        if (stat.isDirectory()) {
            finalPath = path.join(filePath, 'index.html');
        }

        const ext = path.extname(finalPath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('content-type', mime[ext] ?? 'application/octet-stream');

        const data = await fs.readFile(finalPath);
        res.end(data);
    } catch {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('Bad request');
    }
});

server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Dev server: http://localhost:${port}/`);
});
