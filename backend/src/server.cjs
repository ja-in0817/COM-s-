const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {StateStore}=require('./store.cjs');
const ROOT=path.resolve(__dirname,'../..');
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.svg':'image/svg+xml'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(Error('Request exceeds 1 MiB'),{status:413});chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}}
function equal(a,b){const aa=Buffer.from(a||''),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
async function createApp({file=path.join(ROOT,'backend/data/state.json')}={}){
 const store=await new StateStore(file).init();
 const session=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
  const port=server.address()?.port;const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
  if(!hosts.has(req.headers.host))return json(res,403,{error:'This development server accepts loopback hosts only'});
  let url;try{url=new URL(req.url,'http://'+req.headers.host)}catch{return json(res,400,{error:'Invalid URL'})}
  try{
   if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,mode:'single-user-local-development',automaticAidDelivery:false});
   if(url.pathname==='/runtime-config.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end('window.MOA_RUNTIME={server:true};')}
   if(url.pathname.startsWith('/api/')){
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('moa_dev='))?.slice(8);
    if(!equal(cookie,session))return json(res,401,{error:'Open the local app before using its API'});
    if(url.pathname!=='/api/state')return json(res,404,{error:'Not found'});
    if(req.method==='GET')return json(res,200,store.read());
    if(req.method!=='PUT')return json(res,405,{error:'Method not allowed'});
    if(req.headers.origin!=='http://'+req.headers.host)return json(res,403,{error:'Same-origin write required'});
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'application/json required'});
    const data=await body(req);if(!Number.isInteger(data.expectedRevision))return json(res,422,{error:'expectedRevision required'});
    const saved=await store.write(data.state,data.expectedRevision);return json(res,200,{revision:saved.revision});
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
   let relative;try{relative=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Invalid path'})}
   const shared=relative.startsWith('/shared/');const base=shared?path.join(ROOT,'shared'):path.join(ROOT,'frontend/public');
   const suffix=shared?relative.slice('/shared/'.length):relative==='/'?'index.html':relative.slice(1);
   const filePath=path.resolve(base,suffix);
   if(!filePath.startsWith(base+path.sep)||suffix.split('/').some(s=>s.startsWith('.')))return json(res,403,{error:'Forbidden path'});
   const data=await fs.readFile(filePath);
   if(relative==='/'||relative==='/index.html')res.setHeader('Set-Cookie',`moa_dev=${session}; HttpOnly; SameSite=Strict; Path=/`);
   res.writeHead(200,{'Content-Type':MIME[path.extname(filePath)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(e.code==='ENOENT'||e.code==='EISDIR')return json(res,404,{error:'Not found'});json(res,e.status||500,{error:e.status?e.message:'Storage operation failed'})}
 });
 return {server,store};
}
if(require.main===module){const port=Number(process.env.PORT||3000);createApp().then(({server})=>server.listen(port,'127.0.0.1',()=>console.log(`wargether development app: http://127.0.0.1:${server.address().port}`))).catch(e=>{console.error(e.message);process.exitCode=1})}
module.exports={createApp};
