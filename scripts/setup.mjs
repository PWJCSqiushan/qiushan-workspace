import {copyFileSync,existsSync} from 'node:fs';
if(!existsSync('wrangler.jsonc'))copyFileSync('wrangler.example.jsonc','wrangler.jsonc');
console.log('Local config is ready. Existing settings were preserved.');
