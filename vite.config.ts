import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import {defineConfig} from 'vite';
export default defineConfig(async({command})=>{
 process.env.WRANGLER_WRITE_LOGS??='false';
 process.env.MINIFLARE_REGISTRY_PATH??='.wrangler/registry';
 const {cloudflare}=await import('@cloudflare/vite-plugin');
 return {build:{emptyOutDir:false},css:{postcss:{plugins:[tailwindcss()]}},plugins:[vinext(),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']},...(command==='serve'?{config:{vars:{AUTH_MODE:'local'},assets:{run_worker_first:false}}}:{})})]};
});
