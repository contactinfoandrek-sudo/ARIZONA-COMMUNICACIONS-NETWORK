import { DurableObject } from "cloudflare:workers";

const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization","access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS"}});
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const ub64 = s => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
const rand = n => b64(crypto.getRandomValues(new Uint8Array(n)));
const norm = s => String(s||'').trim().toLowerCase();

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? ub64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'}, key, 256);
  return {salt:b64(salt), hash:b64(bits)};
}
async function verifyPassword(password, salt, expected) {
  const got = await hashPassword(password, salt);
  return got.hash === expected;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'}});
    const id = env.ACN_ROOM.idFromName('global');
    return env.ACN_ROOM.get(id).fetch(request);
  }
};

export class ACNRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async()=>{ this.init(); });
  }
  init() {
    const s=this.ctx.storage.sql;
    s.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, display_name TEXT NOT NULL, number TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'offline', created_at INTEGER NOT NULL);`);
    s.exec(`CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    s.exec(`CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    s.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, callee_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, ended_at INTEGER);`);
    s.exec(`CREATE TABLE IF NOT EXISTS dispatch(id INTEGER PRIMARY KEY CHECK(id=1), user_id TEXT, claimed_at INTEGER);`);
    s.exec(`INSERT OR IGNORE INTO dispatch(id,user_id,claimed_at) VALUES(1,NULL,NULL);`);
    s.exec(`CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  async fetch(request) {
    const url=new URL(request.url);
    if (url.pathname==='/ws') return this.websocket(request);
    if (!url.pathname.startsWith('/api/')) return json({ok:true,name:'Arizona Communications Network',service:'ACN API',version:'1.0.0'});
    try { return await this.api(request,url); } catch(e) { return json({error:e?.message||'Server error'},500); }
  }
  async auth(request) {
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token) return null;
    const row=this.ctx.storage.sql.exec(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`,token,Date.now()).toArray()[0];
    return row||null;
  }
  number() {
    for(let i=0;i<20;i++){
      const n=`928-555-${String(Math.floor(1000+Math.random()*9000))}`;
      if(!this.ctx.storage.sql.exec(`SELECT 1 FROM users WHERE number=?`,n).toArray().length) return n;
    }
    throw new Error('Could not allocate ACN number');
  }
  async api(request,url){
    const path=url.pathname.replace('/api/','');
    if(request.method==='GET' && path==='health') return json({ok:true,name:'Arizona Communications Network',version:'2.0.0'});
    if(request.method==='POST' && path==='auth/register'){
      const b=await request.json(); const username=norm(b.username), password=String(b.password||''), display=String(b.displayName||b.username||'').trim();
      if(!/^[a-z0-9_.-]{3,24}$/.test(username)) return json({error:'Username must be 3-24 characters.'},400);
      if(password.length<8) return json({error:'Password must be at least 8 characters.'},400);
      if(this.ctx.storage.sql.exec(`SELECT 1 FROM users WHERE username=?`,username).toArray().length) return json({error:'Username already exists.'},409);
      const hp=await hashPassword(password); const id=crypto.randomUUID(); const number=this.number(); const hasAdmin=!!this.ctx.storage.sql.exec(`SELECT 1 FROM users WHERE role='admin' LIMIT 1`).toArray().length; const role=hasAdmin?'user':'admin';
      this.ctx.storage.sql.exec(`INSERT INTO users(id,username,password_hash,salt,display_name,number,role,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,username,hp.hash,hp.salt,display||username,number,role,'online',Date.now());
      const token=rand(32); this.ctx.storage.sql.exec(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`,token,id,Date.now()+30*24*3600*1000);
      return json({token,user:{id,username,displayName:display||username,number,role,status:'online'}} ,201);
    }
    if(request.method==='POST' && path==='auth/login'){
      const b=await request.json(); const username=norm(b.username), password=String(b.password||'');
      const u=this.ctx.storage.sql.exec(`SELECT * FROM users WHERE username=?`,username).toArray()[0];
      if(!u || !(await verifyPassword(password,u.salt,u.password_hash))) return json({error:'Invalid ACN username or password.'},401);
      this.ctx.storage.sql.exec(`UPDATE users SET status='online' WHERE id=?`,u.id);
      const token=rand(32); this.ctx.storage.sql.exec(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`,token,u.id,Date.now()+30*24*3600*1000);
      return json({token,user:{id:u.id,username:u.username,displayName:u.display_name,number:u.number,role:u.role,status:'online'}});
    }
    const me=await this.auth(request); if(!me) return json({error:'Authentication required.'},401);
    if(request.method==='POST' && path==='auth/logout'){ this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE user_id=?`,me.id); this.ctx.storage.sql.exec(`UPDATE users SET status='offline' WHERE id=?`,me.id); return json({ok:true}); }
    if(request.method==='GET' && path==='me') return json({user:{id:me.id,username:me.username,displayName:me.display_name,number:me.number,role:me.role,status:me.status}});
    if(request.method==='GET' && path==='users'){
      const q=norm(url.searchParams.get('q')||''); const rows=q?this.ctx.storage.sql.exec(`SELECT id,username,display_name,number,role,status FROM users WHERE username LIKE ? OR display_name LIKE ? OR number LIKE ? ORDER BY display_name LIMIT 50`,`%${q}%`,`%${q}%`,`%${q}%`).toArray():this.ctx.storage.sql.exec(`SELECT id,username,display_name,number,role,status FROM users ORDER BY display_name LIMIT 50`).toArray();
      return json({users:rows.map(u=>({id:u.id,username:u.username,displayName:u.display_name,number:u.number,role:u.role,status:u.status}))});
    }
    if(request.method==='GET' && path==='messages'){
      const peer=url.searchParams.get('peer'); if(!peer) return json({error:'peer required'},400);
      const rows=this.ctx.storage.sql.exec(`SELECT id,sender_id,receiver_id,body,created_at FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC LIMIT 200`,me.id,peer,peer,me.id).toArray();
      return json({messages:rows});
    }
    if(request.method==='POST' && path==='messages'){
      const b=await request.json(); const receiver=String(b.receiverId||''); const body=String(b.body||'').trim(); if(!receiver||!body) return json({error:'receiverId and body required'},400);
      const id=this.ctx.storage.sql.exec(`INSERT INTO messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?) RETURNING id`,me.id,receiver,body,Date.now()).toArray()[0].id;
      this.broadcast({type:'message',message:{id,senderId:me.id,receiverId:receiver,body,createdAt:Date.now()}} , receiver);
      return json({ok:true,id});
    }
    if(request.method==='POST' && path==='admin/users/role'){
      if(me.role!=='admin') return json({error:'Admin only.'},403);
      const b=await request.json(); const uid=String(b.userId||''), role=String(b.role||'user');
      if(!uid || !['user','dispatcher','admin'].includes(role)) return json({error:'Invalid user or role.'},400);
      this.ctx.storage.sql.exec(`UPDATE users SET role=? WHERE id=?`,role,uid); this.broadcast({type:'user-role',userId:uid,role}); return json({ok:true});
    }
    if(request.method==='GET' && path==='dispatch'){
      const d=this.ctx.storage.sql.exec(`SELECT d.user_id,d.claimed_at,u.display_name,u.number FROM dispatch d LEFT JOIN users u ON u.id=d.user_id WHERE d.id=1`).toArray()[0];
      return json({occupied:!!d.user_id,dispatcher:d.user_id?{id:d.user_id,displayName:d.display_name,number:d.number}:null,claimedAt:d.claimed_at});
    }
    if(request.method==='POST' && path==='dispatch/claim'){
      if(!['admin','dispatcher'].includes(me.role)) return json({error:'Only authorized dispatch users can claim Central Dispatch.'},403);
      const result=this.ctx.storage.sql.exec(`UPDATE dispatch SET user_id=?,claimed_at=? WHERE id=1 AND user_id IS NULL`,me.id,Date.now());
      if(result.rowsWritten===0) return json({error:'Central Dispatch is already occupied.'},409);
      this.broadcast({type:'dispatch',occupied:true,dispatcher:{id:me.id,displayName:me.display_name,number:me.number}}); return json({ok:true});
    }
    if(request.method==='POST' && path==='dispatch/release'){
      if(me.role!=='admin') return json({error:'Admin only.'},403);
      this.ctx.storage.sql.exec(`UPDATE dispatch SET user_id=NULL,claimed_at=NULL WHERE id=1`); this.broadcast({type:'dispatch',occupied:false}); return json({ok:true});
    }
    if(request.method==='POST' && path==='announcements'){
      if(me.role!=='admin') return json({error:'Admin only.'},403);
      const b=await request.json(); const title=String(b.title||'ACN Announcement').slice(0,80), body=String(b.body||'').trim().slice(0,500); if(!body)return json({error:'body required'},400);
      const id=this.ctx.storage.sql.exec(`INSERT INTO announcements(sender_id,title,body,created_at) VALUES(?,?,?,?) RETURNING id`,me.id,title,body,Date.now()).toArray()[0].id;
      this.broadcast({type:'announcement',announcement:{id,title,body,createdAt:Date.now()}}); return json({ok:true,id});
    }
    if(request.method==='POST' && path==='calls'){
      const b=await request.json(); const calleeId=b.calleeId||null; const type=b.type||'voice'; const id=crypto.randomUUID();
      this.ctx.storage.sql.exec(`INSERT INTO calls(id,caller_id,callee_id,type,status,created_at) VALUES(?,?,?,?,?,?)`,id,me.id,calleeId,type,'ringing',Date.now());
      this.broadcast({type:'incoming-call',call:{id,callerId:me.id,callerName:me.display_name,callerNumber:me.number,calleeId,type}},calleeId);
      return json({ok:true,callId:id});
    }
    if(request.method==='POST' && path==='calls/911'){
      const d=this.ctx.storage.sql.exec(`SELECT user_id FROM dispatch WHERE id=1`).toArray()[0];
      const id=crypto.randomUUID(); this.ctx.storage.sql.exec(`INSERT INTO calls(id,caller_id,callee_id,type,status,created_at) VALUES(?,?,?,?,?,?)`,id,me.id,d?.user_id||null,'911',d?.user_id?'ringing':'waiting',Date.now());
      this.broadcast({type:'911',call:{id,callerId:me.id,callerName:me.display_name,callerNumber:me.number,status:d?.user_id?'ringing':'waiting'}},d?.user_id||null);
      return json({ok:true,callId:id,status:d?.user_id?'ringing':'waiting'});
    }
    if(request.method==='POST' && path==='calls/end'){
      const b=await request.json(); this.ctx.storage.sql.exec(`UPDATE calls SET status='ended',ended_at=? WHERE id=?`,Date.now(),b.callId); this.broadcast({type:'call-ended',callId:b.callId}); return json({ok:true});
    }
    return json({error:'Not found'},404);
  }
  websocket(request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response('Expected WebSocket',{status:426});
    const token=new URL(request.url).searchParams.get('token');
    if(!token) return new Response('Unauthorized',{status:401});
    const u=this.ctx.storage.sql.exec(`SELECT u.id,u.display_name, u.number,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`,token,Date.now()).toArray()[0];
    if(!u) return new Response('Unauthorized',{status:401});
    const pair=new WebSocketPair(); const client=pair[0], server=pair[1]; this.ctx.acceptWebSocket(server); server.serializeAttachment({userId:u.id,name:u.display_name,number:u.number,role:u.role});
    server.send(JSON.stringify({type:'ready',user:{id:u.id,displayName:u.display_name,number:u.number,role:u.role}}));
    this.broadcast({type:'presence',userId:u.id,status:'online',displayName:u.display_name},u.id);
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message){
    try { const data=JSON.parse(message); const me=ws.deserializeAttachment(); if(data.type==='signal'&&data.to){this.sendToUser(data.to,{type:'signal',from:me.id,signal:data.signal,callId:data.callId});} else if(data.type==='presence'){this.broadcast({type:'presence',userId:me.id,status:data.status||'online',displayName:me.name});} } catch {}
  }
  webSocketClose(ws){ const me=ws.deserializeAttachment(); if(me) this.broadcast({type:'presence',userId:me.id,status:'offline',displayName:me.name},me.id); }
  webSocketError(ws){ try{this.webSocketClose(ws)}catch{} }
  sockets(){return this.ctx.getWebSockets();}
  sendToUser(id,payload){for(const ws of this.sockets()){const a=ws.deserializeAttachment();if(a?.userId===id){try{ws.send(JSON.stringify(payload))}catch{}}}}
  broadcast(payload,except=null){const raw=JSON.stringify(payload);for(const ws of this.sockets()){const a=ws.deserializeAttachment();if(except&&a?.userId===except)continue;try{ws.send(raw)}catch{}}}
}
