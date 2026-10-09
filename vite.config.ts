import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import {defineConfig} from 'vite';
export default defineConfig(async({command})=>{
 process.env.WRANGLER_WRITE_LOGS??='false';
 process.env.MINIFLARE_REGISTRY_PATH??='.wrangler/registry';
 const {cloudflare}=await import('@cloudflare/vite-plugin');
 return {cacheDir:'work/vite-cache',build:{emptyOutDir:false},worker:{format:'es' as const,plugins:()=>[{
  name:'pdf-worker-global-checks',
  enforce:'pre' as const,
  // vinext folds this check to object for client pages; a Worker has no window.
  // Preserve the runtime guard before that client define can erase it.
  transform(code:string){
   if(!/\btypeof\s+window\b/.test(code))return null;
   return {code:code.replace(/\btypeof\s+window\b/g,'typeof globalThis.window'),map:null};
  },
 }]},css:{postcss:{plugins:[tailwindcss()]}},plugins:[vinext(),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']},...(command==='serve'?{config:{vars:{AUTH_MODE:'local'},assets:{run_worker_first:false}}}:{})})]};
});
