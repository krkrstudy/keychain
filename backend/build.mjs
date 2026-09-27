import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/server', {recursive:true});
await copyFile('src/index.js','dist/server/index.js');
console.log('Built standalone Cloudflare Worker.');
