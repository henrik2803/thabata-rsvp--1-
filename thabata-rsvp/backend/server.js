import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.env.DATA_DIR||path.join(root,'data'); mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'rsvp.sqlite')); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS guests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)');
if(!db.prepare('PRAGMA table_info(guests)').all().some(c=>c.name==='companions')) db.exec("ALTER TABLE guests ADD COLUMN companions TEXT NOT NULL DEFAULT '[]'");
const password=process.env.ADMIN_PASSWORD;
if(!password||password.length<12) {console.error('Defina ADMIN_PASSWORD com pelo menos 12 caracteres no arquivo .env. Consulte README.md.'); process.exit(1);}
const salt=randomBytes(16), hash=scryptSync(password,salt,64), sessions=new Map(), limits=new Map();
const secure=process.env.NODE_ENV==='production';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const cookie=(token,age=28800)=>`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>16384) throw Error('body');}try{return JSON.parse(s);}catch{throw Error('body');}}
function rate(req,key,max){const k=key+req.socket.remoteAddress;const now=Date.now();let v=limits.get(k);if(!v||v.until<now) {v={count:0,until:now+900000};limits.set(k,v);}return ++v.count<=max;}
const cleanup=setInterval(()=>{const n=Date.now();for(const [k,v]of sessions)if(v<n)sessions.delete(k);for(const [k,v]of limits)if(v.until<n)limits.delete(k);},60000);cleanup.unref();
export const server=http.createServer(async(req,res)=>{
res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
try{
const url=new URL(req.url,'http://localhost'), p=url.pathname;
if(!['GET','HEAD'].includes(req.method)){
if(req.headers.origin){const o=new URL(req.headers.origin);if(o.host!==req.headers.host)return send(res,403,{error:'Origem não autorizada.'});}
if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'Envie JSON.'});
}
const token=(req.headers.cookie||'').match(/(?:^|;\s*)session=([a-f0-9]+)/)?.[1];const auth=token&&sessions.get(token)>Date.now();
if(p==='/api/rsvp'&&req.method==='POST'){
if(!rate(req,'rsvp',20))return send(res,429,{error:'Muitas tentativas. Aguarde 15 minutos.'});
const data=await body(req);const name=typeof data.name==='string'?data.name.trim().replace(/\s+/g,' '):'';
let phone=typeof data.phone==='string'?data.phone.replace(/\D/g,''):'';if(phone.startsWith('55')&&phone.length>=12)phone=phone.slice(2);
if(name.length<3||name.length>100||!/[\p{L}]/u.test(name)||!/^[1-9]{2}[2-9]\d{7,8}$/.test(phone)||data.consent!==true)return send(res,400,{error:'Informe seu nome, telefone com DDD e aceite o uso dos dados.'});
const companions=data.companions??[];
if(!Array.isArray(companions)||companions.length>20||companions.some(c=>!c||typeof c.name!=='string'||c.name.trim().length<2||c.name.trim().length>100||!/[\p{L}]/u.test(c.name)||!['0-4','5-9','10+'].includes(c.ageGroup)))return send(res,400,{error:'Informe nome e faixa etária de cada acompanhante (máximo 20).'});
const result=db.prepare('INSERT INTO guests(name,phone,created_at,companions) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING').run(name,phone,new Date().toISOString(),JSON.stringify(companions.map(c=>({name:c.name.trim().replace(/\s+/g,' '),ageGroup:c.ageGroup}))));
if(!result.changes)return send(res,409,{error:'Este telefone já tem uma confirmação. Para alterar seu grupo, entre em contato com a organização.'});
return send(res,201,{message:'Presença confirmada!',total:1+companions.length});
}
if(p==='/api/login'&&req.method==='POST'){
if(!rate(req,'login',10))return send(res,429,{error:'Muitas tentativas. Aguarde 15 minutos.'});const b=await body(req);const candidate=scryptSync(typeof b.password==='string'?b.password:'',salt,64);
if(!timingSafeEqual(candidate,hash))return send(res,401,{error:'Senha incorreta.'});const t=randomBytes(32).toString('hex');sessions.set(t,Date.now()+28800000);res.setHeader('Set-Cookie',cookie(t));return send(res,200,{ok:true});
}
if(p==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{ok:true});}
if(p.startsWith('/api/admin/')){
if(!auth)return send(res,401,{error:'Faça login para acessar o painel.'});
if(p==='/api/admin/guests'&&req.method==='GET')return send(res,200,{guests:db.prepare('SELECT * FROM guests ORDER BY id DESC').all().map(g=>({...g,companions:JSON.parse(g.companions)}))});
if(/^\/api\/admin\/guests\/\d+$/.test(p)&&req.method==='DELETE'){const result=db.prepare('DELETE FROM guests WHERE id=?').run(Number(p.split('/').pop()));return send(res,result.changes?200:404,{ok:!!result.changes});}
}
if(req.method==='GET'||req.method==='HEAD'){
const files={'/':'index.html','/admin':'admin.html','/style.css':'style.css','/fonts/Fredoka.ttf':'fonts/Fredoka.ttf','/app.js':'app.js','/admin.js':'admin.js'};if(files[p]){const ext=path.extname(files[p]);res.setHeader('Content-Type',({'.ttf':'font/ttf','.html':'text/html','.css':'text/css','.js':'text/javascript'})[ext]+'; charset=utf-8');res.end(req.method==='HEAD'?'':readFileSync(path.join(root,'public',files[p])));return;}
}
send(res,404,{error:'Não encontrado.'});
}catch(e){send(res,e.message==='body'?400:500,{error:e.message==='body'?'Dados inválidos.':'Não foi possível concluir. Tente novamente.'});}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`Convite: http://localhost:${server.address().port} | Painel: /admin`));
