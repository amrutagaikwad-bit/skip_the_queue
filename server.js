require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const dbFile = path.resolve(process.env.DB_FILE || './data/skipthequeue.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
app.use(cors()); app.use(express.json({limit:'1mb'}));

// Database schema
 db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('citizen','staff','admin')),
 phone TEXT DEFAULT '', preferred_language TEXT DEFAULT 'English', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS branches (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL,
 city TEXT NOT NULL, service_type TEXT NOT NULL, open_time TEXT DEFAULT '09:00', close_time TEXT DEFAULT '17:00', active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS appointments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
 service TEXT NOT NULL, appointment_date TEXT NOT NULL, slot TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'booked', priority TEXT NOT NULL DEFAULT 'normal', estimated_minutes INTEGER NOT NULL DEFAULT 15,
 notes TEXT DEFAULT '', checked_in_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(branch_id, appointment_date, slot, status)
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 message TEXT NOT NULL, read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), appointment_id INTEGER REFERENCES appointments(id),
 rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS complaints (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
 message TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', status TEXT NOT NULL DEFAULT 'open',
 suggested_team TEXT DEFAULT 'Support team', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Additive migrations keep existing demo databases compatible with newer versions.
function ensureColumn(table, column, definition) {
 const cols = db.prepare(`PRAGMA table_info(${table})`).all();
 if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users','branch_id','INTEGER REFERENCES branches(id)');
ensureColumn('appointments','assigned_counter_id','INTEGER');
ensureColumn('appointments','started_at','TEXT');
ensureColumn('appointments','completed_at','TEXT');
ensureColumn('appointments','actual_duration_minutes','INTEGER');
ensureColumn('complaints','branch_id','INTEGER REFERENCES branches(id)');
ensureColumn('complaints','updated_at','TEXT');
ensureColumn('branches','latitude','REAL');
ensureColumn('branches','longitude','REAL');
db.exec(`
 CREATE TABLE IF NOT EXISTS counters (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL REFERENCES branches(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, current_appointment_id INTEGER, UNIQUE(branch_id,name));
 CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER REFERENCES branches(id), name TEXT NOT NULL, average_minutes INTEGER NOT NULL DEFAULT 15, active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 INSERT OR IGNORE INTO app_settings(key,value) VALUES ('no_show_grace_minutes','10');
 INSERT OR IGNORE INTO app_settings(key,value) VALUES ('priority_order','disability,senior,urgent,normal');
`);

const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!count) {
 const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,phone,preferred_language) VALUES(?,?,?,?,?,?)');
 const hash = bcrypt.hashSync('Queue@123', 10);
 addUser.run('Aarav Sharma','citizen@skipthequeue.demo',hash,'citizen','9876543210','English');
 addUser.run('Priya Staff','staff@skipthequeue.demo',hash,'staff','9876543211','English');
 addUser.run('Admin User','admin@skipthequeue.demo',hash,'admin','9876543212','English');
 const addBranch = db.prepare('INSERT INTO branches(name,address,city,service_type) VALUES(?,?,?,?)');
 addBranch.run('Central Citizen Service Centre','12 MG Road, near Metro Station','Pune','Government services');
 addBranch.run('Aundh Smart Service Hub','Baner Road, Aundh','Pune','Certificates & documents');
 addBranch.run('Kothrud Community Centre','Paud Road, Kothrud','Pune','General assistance');
 const addAppt = db.prepare('INSERT INTO appointments(user_id,branch_id,service,appointment_date,slot,token,status,priority,estimated_minutes,notes) VALUES(?,?,?,?,?,?,?,?,?,?)');
 const today = new Date(); const day = d => { const x=new Date(today); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10); };
 const seed = [
  [1,1,'Document verification',day(0),'10:00','STQ-2401','checked_in','normal',12,'Bring original documents'],
  [1,1,'Address update',day(0),'10:30','STQ-2402','waiting','senior',10,''],
  [1,2,'Certificate application',day(0),'11:00','STQ-2403','booked','normal',18,''],
  [1,3,'General enquiry',day(1),'09:30','STQ-2404','booked','normal',8,'']
 ]; seed.forEach(a=>addAppt.run(...a));
 const addNote=db.prepare('INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)');
 addNote.run(1,'Welcome to SkipTheQueue','Your smart queue dashboard is ready. Book a slot to get started.');
 addNote.run(2,'Staff workspace ready','Review today’s queue and call the next token when ready.');
 // Seed a realistic, varied demo queue and completed history for prediction/forecasting.
 const coords=[[13.0827,80.2707],[13.0569,80.2425],[13.0358,80.2447]];
 coords.forEach((c,i)=>db.prepare('UPDATE branches SET latitude=?,longitude=? WHERE id=?').run(c[0],c[1],i+1));
 const names=['Meera Iyer','Karthik Raj','Ananya Das','Vikram Nair','Sana Khan','Arjun Patel','Divya Menon','Rahul Bose','Ishita Rao','Manoj Kumar','Pooja Shah','Naveen Reddy','Aditi Sen','Farhan Ali','Kavya Pillai','Rohan Das','Neha Verma','Siddharth Jain','Tara Krishnan','Imran Sheikh','Lakshmi Devi','Dev Malhotra','Nisha Paul','Gautam Roy'];
 const services=['Document verification','Address update','Certificate application','General enquiry'];
 const addDemo=db.prepare('INSERT INTO users(name,email,password_hash,role,phone,preferred_language) VALUES(?,?,?,?,?,?)');
 names.forEach((name,i)=>addDemo.run(name,`demo.citizen${i+1}@skipthequeue.demo`,hash,'citizen',`900000${String(i+1).padStart(4,'0')}`,'English'));
 const demoIds=db.prepare("SELECT id FROM users WHERE email LIKE 'demo.citizen%@skipthequeue.demo' ORDER BY id").all().map(x=>x.id);
 const addQueue=db.prepare('INSERT INTO appointments(user_id,branch_id,service,appointment_date,slot,token,status,priority,estimated_minutes,notes,assigned_counter_id,checked_in_at,started_at,completed_at,actual_duration_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 let seq=2501;
 for(let i=0;i<24;i++){
   const branch=(i%3)+1, service=services[i%services.length], hh=9+Math.floor((i%16)/4), mm=[0,15,30,45][i%4], slot=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
   const status=i<3?'serving':i<15?'waiting':i<19?'booked':'completed';
   const priority=i%11===0?'disability':i%7===0?'senior':'normal';
   const duration=[8,12,17,10,14,20,9,13][i%8];
   const now=new Date().toISOString();
   addQueue.run(
  demoIds[i],
  branch,
  service,
  day(0),
  slot,
  `STQ-${seq++}`,
  status,
  priority,
  duration,
  'Seeded demo record',
  status === 'serving' ? branch : null,
  ['waiting', 'serving', 'completed'].includes(status) ? now : null,
  status === 'serving' ? now : null,
  status === 'completed' ? now : null,
  status === 'completed' ? duration : null
  );
 }
 // Completed historical samples on previous days train the transparent baseline model.
 for(let d=1;d<=21;d++) for(let i=0;i<6;i++){
   const branch=(i%3)+1,service=services[i%services.length],slot=String(9+Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'30':'00');
   addQueue.run(demoIds[(d+i)%demoIds.length],branch,service,day(-d),slot,`HIST-${d}-${i}`, 'completed','normal',[8,11,16,9,14,19][(d+i)%6],'Seeded historical training sample',null,null,null,new Date(Date.now()-d*86400000).toISOString(),[8,11,16,9,14,19][(d+i)%6]);
 }
}

function createToken(){ return 'STQ-' + Math.random().toString(36).slice(2,6).toUpperCase(); }
function sign(user){ return jwt.sign({id:user.id,name:user.name,email:user.email,role:user.role,branch_id:user.branch_id||null},JWT_SECRET,{expiresIn:'12h'}); }
function auth(req,res,next){ const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null; if(!token) return res.status(401).json({error:'Please sign in to continue.'}); try{req.user=jwt.verify(token,JWT_SECRET);next();}catch(e){return res.status(401).json({error:'Session expired. Please sign in again.'});} }
function allow(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'You do not have permission to perform this action.'});}
function notify(userId,title,message){db.prepare('INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)').run(userId,title,message);}
function prediction(service, branchId, date, slot){
 const historical = db.prepare(`SELECT AVG(COALESCE(actual_duration_minutes, estimated_minutes)) avg, COUNT(*) n FROM appointments WHERE branch_id=? AND service=? AND status='completed' AND actual_duration_minutes IS NOT NULL`).get(branchId,service);
 const serviceRow = db.prepare('SELECT average_minutes FROM services WHERE (branch_id=? OR branch_id IS NULL) AND name=? AND active=1 ORDER BY branch_id DESC LIMIT 1').get(branchId,service);
 const fallback = serviceRow?.average_minutes || (/document|verification/i.test(service)?12:/certificate/i.test(service)?18:/enquiry|general/i.test(service)?8:15);
 const historicalAvg = historical?.avg ? Number(historical.avg) : fallback;
 const booked=db.prepare("SELECT COUNT(*) n FROM appointments WHERE branch_id=? AND appointment_date=? AND slot<=? AND status IN ('booked','waiting','checked_in','serving')").get(branchId,date,slot).n;
 const hour=Number(String(slot).slice(0,2)); const peak=(hour>=10&&hour<=12)?1.15:(hour>=14&&hour<=15)?1.08:1;
 const queueLoad=1+Math.min(0.35,booked*0.025);
 const minutes=Math.max(5,Math.min(60,Math.round((historicalAvg*0.7+fallback*0.3)*peak*queueLoad)));
 return {service_minutes:minutes, historical_average_minutes:Math.round(historicalAvg*10)/10, sample_size:Number(historical?.n||0), queue_ahead:booked, estimated_wait_minutes:Math.max(0,booked*minutes), method:'weighted historical average (70%) + service baseline (30%), adjusted for time of day and current queue load', is_prediction:true};
}
function estimate(service, branchId, date, slot){ return prediction(service,branchId,date,slot).service_minutes; }
function audit(actorId,action,entityType,entityId,details=''){ db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)').run(actorId,action,entityType,entityId,String(details).slice(0,1000)); }
function recalculateQueue(branchId,date){
 const rows=db.prepare("SELECT id,estimated_minutes FROM appointments WHERE branch_id=? AND appointment_date=? AND status IN ('waiting','checked_in','booked','serving') ORDER BY CASE priority WHEN 'disability' THEN 0 WHEN 'senior' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, slot, id").all(branchId,date);
 let ahead=0; const result=[]; for(const r of rows){result.push({id:r.id,position:++ahead,estimated_wait_minutes:Math.max(0,ahead-1)*r.estimated_minutes});} return result;
}

app.get('/api/health',(req,res)=>res.json({status:'ok',app:'SkipTheQueue',time:new Date().toISOString()}));
app.post('/api/auth/register',(req,res)=>{
 const {name,email,password,phone='',preferred_language='English'}=req.body||{};
 if(!name||!email||!password||password.length<8) return res.status(400).json({error:'Name, email and a password of at least 8 characters are required.'});
 try{const info=db.prepare('INSERT INTO users(name,email,password_hash,role,phone,preferred_language) VALUES(?,?,?,?,?,?)').run(name.trim(),email.toLowerCase().trim(),bcrypt.hashSync(password,10),'citizen',phone,preferred_language); const user=db.prepare('SELECT id,name,email,role,phone,preferred_language FROM users WHERE id=?').get(info.lastInsertRowid); notify(user.id,'Welcome aboard','Your SkipTheQueue account has been created.'); res.status(201).json({token:sign(user),user});}catch(e){res.status(409).json({error:'An account with this email already exists.'});}
});
app.post('/api/auth/login',(req,res)=>{const {email,password}=req.body||{};const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').toLowerCase().trim());if(!user||!bcrypt.compareSync(password||'',user.password_hash))return res.status(401).json({error:'Email or password is incorrect.'});const safe={id:user.id,name:user.name,email:user.email,role:user.role,phone:user.phone,preferred_language:user.preferred_language,branch_id:user.branch_id||null};res.json({token:sign(safe),user:safe});});
app.get('/api/me',auth,(req,res)=>{const user=db.prepare('SELECT id,name,email,role,phone,preferred_language FROM users WHERE id=?').get(req.user.id);res.json({user});});
// Public, privacy-preserving queue feed: no names, phone numbers, or account identifiers.
app.get('/api/public/live-queue',(req,res)=>{
 const date=req.query.date||new Date().toISOString().slice(0,10), branchId=req.query.branch_id?Number(req.query.branch_id):null;
 const rows=db.prepare(`SELECT a.id,a.token,a.service,a.status,a.priority,a.estimated_minutes,a.slot,a.appointment_date,a.assigned_counter_id,c.name counter_name,b.id branch_id,b.name branch_name FROM appointments a JOIN branches b ON b.id=a.branch_id LEFT JOIN counters c ON c.id=a.assigned_counter_id WHERE a.appointment_date=? AND a.status IN ('booked','waiting','checked_in','serving') AND (? IS NULL OR a.branch_id=?) ORDER BY a.branch_id,CASE a.status WHEN 'serving' THEN 0 ELSE 1 END,CASE a.priority WHEN 'disability' THEN 0 WHEN 'senior' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,a.slot,a.id`).all(date,branchId,branchId);
 const counts={}; for(const r of rows){counts[r.branch_id]=(counts[r.branch_id]||0)+1;}
 const positions={}; const queue=rows.map(r=>{positions[r.branch_id]=(positions[r.branch_id]||0)+1;return {...r,queue_position:positions[r.branch_id],estimated_wait_minutes:r.status==='serving'?0:Math.max(0,positions[r.branch_id]-1)*r.estimated_minutes};});
 res.set('Cache-Control','no-store');res.json({date,updated_at:new Date().toISOString(),refresh_seconds:10,queue,branch_counts:counts,seeded_demo_data:true});
});
app.get('/api/public/branches',(req,res)=>{
 const branches=db.prepare(`SELECT b.*,COUNT(CASE WHEN a.status IN ('booked','waiting','checked_in','serving') AND a.appointment_date=date('now','localtime') THEN 1 END) active_queue,COUNT(CASE WHEN a.status='serving' AND a.appointment_date=date('now','localtime') THEN 1 END) serving_now,COALESCE(AVG(CASE WHEN a.status IN ('booked','waiting','checked_in','serving') AND a.appointment_date=date('now','localtime') THEN a.estimated_minutes END),15) avg_service_minutes FROM branches b LEFT JOIN appointments a ON a.branch_id=b.id WHERE b.active=1 GROUP BY b.id ORDER BY active_queue`).all();
 res.json({branches:branches.map(b=>({...b,estimated_wait_minutes:Math.max(0,b.active_queue-b.serving_now)*Math.round(b.avg_service_minutes),available_slots:Math.max(0,12-b.active_queue),latitude:b.latitude||13.0827,longitude:b.longitude||80.2707})),map_provider:'OpenStreetMap / Leaflet',routing_available:false});
});
app.get('/api/branches',auth,(req,res)=>{const branches=db.prepare('SELECT b.*, (SELECT COUNT(*) FROM appointments a WHERE a.branch_id=b.id AND a.appointment_date=date(\'now\',\'localtime\') AND a.status IN (\'booked\',\'waiting\',\'checked_in\',\'serving\')) AS active_queue FROM branches b WHERE active=1').all();res.json({branches});});
app.get('/api/appointments',auth,(req,res)=>{let sql='SELECT a.*,b.name branch_name,b.address branch_address,b.city,u.name user_name,u.email user_email,c.name counter_name FROM appointments a JOIN branches b ON b.id=a.branch_id JOIN users u ON u.id=a.user_id LEFT JOIN counters c ON c.id=a.assigned_counter_id';let rows;if(req.user.role==='citizen') rows=db.prepare(sql+' WHERE a.user_id=? ORDER BY a.appointment_date DESC,a.slot').all(req.user.id);else rows=db.prepare(sql+' ORDER BY a.appointment_date,a.slot').all();const today=new Date().toISOString().slice(0,10);rows=rows.map(a=>{const q=recalculateQueue(a.branch_id,a.appointment_date).find(x=>x.id===a.id);return {...a,queue_position:q?.position??null,estimated_wait_minutes:q?.estimated_wait_minutes??0,prediction_label:'Prediction — not a guarantee'};});res.json({appointments:rows});});
app.get('/api/appointments/:id/qr',auth,async(req,res)=>{const a=db.prepare('SELECT id,user_id,token,appointment_date,slot,service FROM appointments WHERE id=?').get(Number(req.params.id));if(!a)return res.status(404).json({error:'Appointment not found.'});if(req.user.role==='citizen'&&a.user_id!==req.user.id)return res.status(403).json({error:'This appointment does not belong to your account.'});try{const payload=JSON.stringify({app:'SkipTheQueue',appointment_id:a.id,token:a.token,date:a.appointment_date,slot:a.slot});const dataUrl=await QRCode.toDataURL(payload,{width:220,margin:1,errorCorrectionLevel:'M',color:{dark:'#173f30',light:'#ffffff'}});res.json({data_url:dataUrl,token:a.token});}catch(e){res.status(500).json({error:'Could not generate QR token.'});}});
app.post('/api/appointments',auth,allow('citizen'),(req,res)=>{
 const {branch_id,service,appointment_date,slot,notes=''}=req.body||{};
 const priority='normal';
 if(!branch_id||!service||!appointment_date||!slot)return res.status(400).json({error:'Choose a branch, service, date and time slot.'});
 if(appointment_date < new Date().toISOString().slice(0,10))return res.status(400).json({error:'Please choose today or a future date.'});
 if(!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(slot))return res.status(400).json({error:'Choose a valid 15-minute time slot.'});
 const branch=db.prepare('SELECT * FROM branches WHERE id=? AND active=1').get(Number(branch_id));if(!branch)return res.status(404).json({error:'Branch not found.'});
 const existing=db.prepare("SELECT id FROM appointments WHERE branch_id=? AND appointment_date=? AND slot=? AND status NOT IN ('cancelled','completed','no_show')").get(Number(branch_id),appointment_date,slot);if(existing)return res.status(409).json({error:'That branch and time slot is already booked. Please choose another slot.'});
 const estimated=estimate(service,Number(branch_id),appointment_date,slot);const token=createToken();
 const info=db.prepare('INSERT INTO appointments(user_id,branch_id,service,appointment_date,slot,token,status,priority,estimated_minutes,notes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(req.user.id,Number(branch_id),service,appointment_date,slot,token,'booked',priority,estimated,String(notes).slice(0,500));
 notify(req.user.id,'Appointment confirmed',`Your token ${token} is booked for ${appointment_date} at ${slot}. Estimated service time: ${estimated} minutes.`);
 res.status(201).json({appointment:db.prepare('SELECT a.*,b.name branch_name,b.address branch_address FROM appointments a JOIN branches b ON b.id=a.branch_id WHERE a.id=?').get(info.lastInsertRowid)});
});
app.patch('/api/appointments/:id',auth,(req,res)=>{const a=db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(req.params.id));if(!a)return res.status(404).json({error:'Appointment not found.'});if(req.user.role==='citizen'&&a.user_id!==req.user.id)return res.status(403).json({error:'This appointment does not belong to your account.'});const {status,appointment_date,slot,priority}=req.body||{};
 if(appointment_date||slot){if(req.user.role!=='citizen')return res.status(403).json({error:'Only the citizen can reschedule this appointment.'});if(!['booked','waiting'].includes(a.status))return res.status(400).json({error:'Only booked or waiting appointments can be rescheduled.'});const d=appointment_date||a.appointment_date,s=slot||a.slot;const collision=db.prepare("SELECT id FROM appointments WHERE branch_id=? AND appointment_date=? AND slot=? AND id<>? AND status NOT IN ('cancelled','completed','no_show')").get(a.branch_id,d,s,a.id);if(collision)return res.status(409).json({error:'That slot is already booked.'});db.prepare('UPDATE appointments SET appointment_date=?,slot=?,estimated_minutes=? WHERE id=?').run(d,s,estimate(a.service,a.branch_id,d,s),a.id);notify(a.user_id,'Appointment updated',`Your appointment has been moved to ${d} at ${s}.`);}
 if(status){if(status!=='cancelled'||req.user.role!=='citizen')return res.status(403).json({error:'Queue status changes must use staff queue actions. Citizens may only cancel their own appointment.'});if(!['booked','waiting'].includes(a.status))return res.status(400).json({error:'This appointment can no longer be cancelled.'});db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(a.id);audit(req.user.id,'cancel_appointment','appointment',a.id,'Citizen cancelled booking');notify(a.user_id,'Appointment cancelled',`Your token ${a.token} was cancelled.`);}
 if(priority){return res.status(403).json({error:'Priority changes must use the audited staff queue workflow.'});}
 res.json({appointment:db.prepare('SELECT a.*,b.name branch_name,b.address branch_address,u.name user_name FROM appointments a JOIN branches b ON b.id=a.branch_id JOIN users u ON u.id=a.user_id WHERE a.id=?').get(a.id)});
});
app.get('/api/queue',auth,allow('staff','admin'),(req,res)=>{const date=req.query.date||new Date().toISOString().slice(0,10);const branchFilter=req.user.role==='staff'&&req.user.branch_id? ' AND a.branch_id=?':'';const params=branchFilter?[date,req.user.branch_id]:[date];const rows=db.prepare(`SELECT a.*,b.name branch_name,u.name user_name,u.phone,c.name counter_name FROM appointments a JOIN branches b ON b.id=a.branch_id JOIN users u ON u.id=a.user_id LEFT JOIN counters c ON c.id=a.assigned_counter_id WHERE a.appointment_date=? AND a.status IN ('booked','waiting','checked_in','serving')${branchFilter} ORDER BY CASE a.priority WHEN 'disability' THEN 0 WHEN 'senior' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, a.slot, a.id`).all(...params);let pos=0;const queue=rows.map(a=>({...a,queue_position:++pos,estimated_wait_minutes:Math.max(0,pos-1)*a.estimated_minutes}));res.json({date,queue,settings:{no_show_grace_minutes:Number(db.prepare("SELECT value FROM app_settings WHERE key='no_show_grace_minutes'").get()?.value||10)}});});
app.get('/api/predictions/:appointmentId',auth,(req,res)=>{const a=db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(req.params.appointmentId));if(!a)return res.status(404).json({error:'Appointment not found.'});if(req.user.role==='citizen'&&a.user_id!==req.user.id)return res.status(403).json({error:'This appointment does not belong to your account.'});const p=prediction(a.service,a.branch_id,a.appointment_date,a.slot);const position=recalculateQueue(a.branch_id,a.appointment_date).find(x=>x.id===a.id);res.json({appointment_id:a.id,token:a.token,...p,queue_position:position?.position??null,estimated_wait_minutes:position?.estimated_wait_minutes??p.estimated_wait_minutes,label:'Prediction — not a guarantee'});});
app.post('/api/queue/check-in',auth,allow('staff','admin'),(req,res)=>{const {token,counter_id}=req.body||{};if(!token)return res.status(400).json({error:'Scan a QR token or enter a token.'});const a=db.prepare("SELECT * FROM appointments WHERE token=? AND status IN ('booked','waiting')").get(String(token).trim());if(!a)return res.status(404).json({error:'Eligible appointment token not found.'});if(req.user.role==='staff'&&req.user.branch_id&&a.branch_id!==req.user.branch_id)return res.status(403).json({error:'This appointment belongs to another branch.'});if(counter_id&&!db.prepare('SELECT id FROM counters WHERE id=? AND branch_id=? AND active=1').get(Number(counter_id),a.branch_id))return res.status(400).json({error:'Counter is not active for this branch.'});db.prepare("UPDATE appointments SET status='waiting',checked_in_at=CURRENT_TIMESTAMP,assigned_counter_id=COALESCE(?,assigned_counter_id) WHERE id=?").run(counter_id?Number(counter_id):null,a.id);audit(req.user.id,'check_in','appointment',a.id,`Token ${a.token}; counter ${counter_id||'unassigned'}`);notify(a.user_id,'Checked in',`Token ${a.token} has checked in and joined the queue.`);res.json({ok:true,appointment:db.prepare('SELECT * FROM appointments WHERE id=?').get(a.id)});});
app.post('/api/queue/next',auth,allow('staff','admin'),(req,res)=>{const {branch_id,counter_id}=req.body||{};const branchId=Number(branch_id||(req.user.branch_id||0));if(!branchId)return res.status(400).json({error:'Select a branch before calling the next customer.'});if(req.user.role==='staff'&&req.user.branch_id&&branchId!==req.user.branch_id)return res.status(403).json({error:'You can only manage your assigned branch.'});const counter=counter_id?db.prepare('SELECT * FROM counters WHERE id=? AND branch_id=? AND active=1').get(Number(counter_id),branchId):null;if(counter_id&&!counter)return res.status(400).json({error:'Counter is not active for this branch.'});const date=new Date().toISOString().slice(0,10);const grace=Number(db.prepare("SELECT value FROM app_settings WHERE key='no_show_grace_minutes'").get()?.value||10);db.prepare("UPDATE appointments SET status='no_show' WHERE branch_id=? AND appointment_date=? AND status IN ('booked','waiting','checked_in') AND checked_in_at IS NULL AND datetime(appointment_date || ' ' || slot || ':00','+'||?||' minutes') < datetime('now','localtime')").run(branchId,date,grace);const a=db.prepare("SELECT * FROM appointments WHERE branch_id=? AND appointment_date=? AND status IN ('waiting','checked_in') ORDER BY CASE priority WHEN 'disability' THEN 0 WHEN 'senior' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END, slot, id LIMIT 1").get(branchId,date);if(!a)return res.status(404).json({error:'No eligible customers are waiting.'});db.prepare("UPDATE appointments SET status='serving',started_at=CURRENT_TIMESTAMP,assigned_counter_id=COALESCE(?,assigned_counter_id) WHERE id=?").run(counter_id?Number(counter_id):null,a.id);if(counter)db.prepare('UPDATE counters SET current_appointment_id=? WHERE id=?').run(a.id,counter.id);audit(req.user.id,'call_next','appointment',a.id,`Counter ${counter?.name||'unassigned'}`);notify(a.user_id,'Your turn is next',`Token ${a.token} is now being served.`);res.json({appointment:db.prepare('SELECT * FROM appointments WHERE id=?').get(a.id)});});
app.patch('/api/queue/:id/status',auth,allow('staff','admin'),(req,res)=>{const {status,priority,counter_id}=req.body||{};const a=db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(req.params.id));if(!a)return res.status(404).json({error:'Appointment not found.'});if(req.user.role==='staff'&&req.user.branch_id&&a.branch_id!==req.user.branch_id)return res.status(403).json({error:'You can only manage your assigned branch.'});if(status&&!['waiting','serving','completed','no_show'].includes(status))return res.status(400).json({error:'Invalid queue state.'});if(priority&&!['normal','senior','disability','urgent'].includes(priority))return res.status(400).json({error:'Invalid priority category.'});if(counter_id&&!db.prepare('SELECT id FROM counters WHERE id=? AND branch_id=? AND active=1').get(Number(counter_id),a.branch_id))return res.status(400).json({error:'Counter is not active for this branch.'});const old={status:a.status,priority:a.priority,counter:a.assigned_counter_id};if(status==='completed'){const activeCounter=db.prepare('SELECT id,branch_id FROM counters WHERE current_appointment_id=?').get(a.id);db.prepare("UPDATE appointments SET status='completed',completed_at=CURRENT_TIMESTAMP,actual_duration_minutes=CASE WHEN started_at IS NOT NULL THEN MAX(1,CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*1440 AS INTEGER)) ELSE actual_duration_minutes END WHERE id=?").run(a.id);db.prepare('UPDATE counters SET current_appointment_id=NULL WHERE current_appointment_id=?').run(a.id);if(activeCounter){const next=db.prepare("SELECT id,user_id,token FROM appointments WHERE branch_id=? AND appointment_date=? AND status IN ('waiting','checked_in') ORDER BY CASE priority WHEN 'disability' THEN 0 WHEN 'senior' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,slot,id LIMIT 1").get(activeCounter.branch_id,a.appointment_date);if(next){db.prepare("UPDATE appointments SET status='serving',started_at=CURRENT_TIMESTAMP,assigned_counter_id=? WHERE id=?").run(activeCounter.id,next.id);db.prepare('UPDATE counters SET current_appointment_id=? WHERE id=?').run(next.id,activeCounter.id);notify(next.user_id,'Your turn is next',`Token ${next.token} is now being served.`);audit(req.user.id,'auto_advance_queue','appointment',next.id,`Counter ${activeCounter.id}; after completing ${a.token}`);}}}else if(status){db.prepare('UPDATE appointments SET status=?,assigned_counter_id=COALESCE(?,assigned_counter_id) WHERE id=?').run(status,counter_id?Number(counter_id):null,a.id);}if(priority)db.prepare('UPDATE appointments SET priority=? WHERE id=?').run(priority,a.id);if(priority||status||counter_id){audit(req.user.id,'queue_override','appointment',a.id,JSON.stringify({before:old,after:{status:status||a.status,priority:priority||a.priority,counter:counter_id||a.assigned_counter_id}}));}notify(a.user_id,'Queue status updated',`Your token ${a.token} is now ${status||a.status}.`);res.json({appointment:db.prepare('SELECT * FROM appointments WHERE id=?').get(a.id),queue:recalculateQueue(a.branch_id,a.appointment_date)});});
app.get('/api/dashboard',auth,allow('staff','admin'),(req,res)=>{const today=new Date().toISOString().slice(0,10);const totals=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('waiting','checked_in','booked') THEN 1 ELSE 0 END) waiting, SUM(CASE WHEN status='serving' THEN 1 ELSE 0 END) serving, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed, SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show, ROUND(AVG(estimated_minutes),1) avg_minutes, ROUND(AVG(CASE WHEN checked_in_at IS NOT NULL AND started_at IS NOT NULL THEN (julianday(started_at)-julianday(checked_in_at))*1440 END),1) avg_waiting_minutes FROM appointments WHERE appointment_date=?").get(today);const branch=db.prepare("SELECT b.id,b.name,COUNT(a.id) bookings,SUM(CASE WHEN a.status='serving' THEN 1 ELSE 0 END) serving,ROUND(100.0*SUM(CASE WHEN a.status='serving' THEN 1 ELSE 0 END)/MAX(1,(SELECT COUNT(*) FROM counters c WHERE c.branch_id=b.id AND c.active=1)),1) utilization_pct FROM branches b LEFT JOIN appointments a ON a.branch_id=b.id AND a.appointment_date>=date('now','-6 days') AND a.status<>'cancelled' GROUP BY b.id ORDER BY bookings DESC").all();const week=db.prepare("SELECT appointment_date day,COUNT(*) count FROM appointments WHERE appointment_date>=date('now','-6 days') GROUP BY appointment_date ORDER BY appointment_date").all();const ratings=db.prepare('SELECT ROUND(AVG(rating),1) rating,COUNT(*) count FROM feedback').get();const complaints=db.prepare("SELECT status,COUNT(*) count FROM complaints GROUP BY status").all();res.json({today,totals,branch,week,ratings,complaints});});
app.get('/api/admin/forecast',auth,allow('admin'),(req,res)=>{const history=db.prepare("SELECT appointment_date day,COUNT(*) demand FROM appointments WHERE status<>'cancelled' AND appointment_date<date('now','+1 day') GROUP BY appointment_date ORDER BY appointment_date DESC LIMIT 28").all().reverse();const avg=history.length?history.reduce((s,x)=>s+x.demand,0)/history.length:0;const byWeekday=db.prepare("SELECT CAST(strftime('%w',appointment_date) AS INTEGER) weekday,AVG(n) avg_demand FROM (SELECT appointment_date,COUNT(*) n FROM appointments WHERE status<>'cancelled' GROUP BY appointment_date) GROUP BY weekday").all();const weekday=new Date().getDay();const match=byWeekday.find(x=>x.weekday===weekday);res.json({label:'Forecast based on historical/sample appointment records; not a guarantee',historical_days:history.length,history,forecast:{date:new Date(Date.now()+86400000).toISOString().slice(0,10),expected_appointments:Math.round(match?.avg_demand??avg),method:'mean appointment count for the same weekday; overall historical mean fallback'},weekday_averages:byWeekday});});
app.get('/api/admin/audit',auth,allow('admin'),(req,res)=>res.json({audit:db.prepare('SELECT l.*,u.name actor_name,u.email actor_email FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 200').all()}));
app.get('/api/admin/settings',auth,allow('admin'),(req,res)=>res.json({settings:Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(x=>[x.key,x.value]))}));
app.patch('/api/admin/settings',auth,allow('admin'),(req,res)=>{const {no_show_grace_minutes}=req.body||{};if(no_show_grace_minutes!==undefined&&(!Number.isInteger(Number(no_show_grace_minutes))||Number(no_show_grace_minutes)<0||Number(no_show_grace_minutes)>120))return res.status(400).json({error:'Grace period must be a whole number from 0 to 120 minutes.'});if(no_show_grace_minutes!==undefined)db.prepare("INSERT INTO app_settings(key,value) VALUES('no_show_grace_minutes',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(no_show_grace_minutes));audit(req.user.id,'update_settings','settings',null,JSON.stringify(req.body));res.json({settings:Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(x=>[x.key,x.value]))});});
app.get('/api/admin/counters',auth,allow('admin','staff'),(req,res)=>{const rows=req.user.role==='staff'&&req.user.branch_id?db.prepare('SELECT * FROM counters WHERE branch_id=? ORDER BY id').all(req.user.branch_id):db.prepare('SELECT * FROM counters ORDER BY branch_id,id').all();res.json({counters:rows});});
app.post('/api/admin/counters',auth,allow('admin'),(req,res)=>{const {branch_id,name}=req.body||{};if(!branch_id||!name)return res.status(400).json({error:'Branch and counter name are required.'});try{const r=db.prepare('INSERT INTO counters(branch_id,name) VALUES(?,?)').run(Number(branch_id),String(name).slice(0,80));audit(req.user.id,'create_counter','counter',r.lastInsertRowid,`Branch ${branch_id}; ${name}`);res.status(201).json({counter:db.prepare('SELECT * FROM counters WHERE id=?').get(r.lastInsertRowid)});}catch(e){res.status(409).json({error:'Could not create counter; check the branch and counter name.'});}});
app.get('/api/admin/services',auth,allow('admin'),(req,res)=>res.json({services:db.prepare('SELECT * FROM services ORDER BY branch_id,name').all()}));
app.post('/api/admin/services',auth,allow('admin'),(req,res)=>{const {branch_id=null,name,average_minutes=15}=req.body||{};if(!name||!Number.isInteger(Number(average_minutes))||Number(average_minutes)<1||Number(average_minutes)>240)return res.status(400).json({error:'Provide a service name and average duration from 1 to 240 minutes.'});const r=db.prepare('INSERT INTO services(branch_id,name,average_minutes) VALUES(?,?,?)').run(branch_id?Number(branch_id):null,String(name).slice(0,100),Number(average_minutes));audit(req.user.id,'create_service','service',r.lastInsertRowid,name);res.status(201).json({service:db.prepare('SELECT * FROM services WHERE id=?').get(r.lastInsertRowid)});});
app.get('/api/notifications',auth,(req,res)=>res.json({notifications:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id)}));
app.patch('/api/notifications/:id/read',auth,(req,res)=>{db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(Number(req.params.id),req.user.id);res.json({ok:true});});
app.post('/api/feedback',auth,(req,res)=>{const {appointment_id,rating,comment=''}=req.body||{};if(!Number.isInteger(Number(rating))||rating<1||rating>5)return res.status(400).json({error:'Rating must be from 1 to 5.'});if(appointment_id){const a=db.prepare('SELECT id FROM appointments WHERE id=? AND user_id=?').get(appointment_id,req.user.id);if(!a)return res.status(404).json({error:'Appointment not found for this account.'});}db.prepare('INSERT INTO feedback(user_id,appointment_id,rating,comment) VALUES(?,?,?,?)').run(req.user.id,appointment_id||null,Number(rating),String(comment).slice(0,1000));res.status(201).json({ok:true});});
app.get('/api/feedback',auth,allow('staff','admin'),(req,res)=>res.json({feedback:db.prepare('SELECT f.*,u.name user_name FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 100').all()}));
app.post('/api/complaints',auth,(req,res)=>{const {subject,message,category='General'}=req.body||{};if(!subject||!message)return res.status(400).json({error:'Subject and message are required.'});const text=(subject+' '+message).toLowerCase();const suggested=/payment|refund|fee|charge/.test(text)?'Accounts team':/accessibility|disability|wheelchair/.test(text)?'Accessibility desk':/staff|behaviour|rude/.test(text)?'Branch manager':'Support team';const latest=db.prepare("SELECT branch_id FROM appointments WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(req.user.id);const info=db.prepare('INSERT INTO complaints(user_id,subject,message,category,suggested_team,branch_id) VALUES(?,?,?,?,?,?)').run(req.user.id,String(subject).slice(0,150),String(message).slice(0,2000),category,suggested,latest?.branch_id||null);notify(req.user.id,'Complaint submitted',`Ticket #${info.lastInsertRowid} has been routed to the ${suggested}.`);res.status(201).json({id:info.lastInsertRowid,status:'open',suggested_team:suggested});});
app.get('/api/complaints',auth,(req,res)=>{const rows=req.user.role==='citizen'?db.prepare('SELECT c.*,u.name user_name FROM complaints c JOIN users u ON u.id=c.user_id WHERE c.user_id=? ORDER BY c.created_at DESC').all(req.user.id):(req.user.role==='staff'&&req.user.branch_id?db.prepare('SELECT c.*,u.name user_name FROM complaints c JOIN users u ON u.id=c.user_id WHERE c.branch_id=? ORDER BY c.created_at DESC').all(req.user.branch_id):db.prepare('SELECT c.*,u.name user_name FROM complaints c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC').all());res.json({complaints:rows});});
app.patch('/api/complaints/:id',auth,allow('staff','admin'),(req,res)=>{const {status}=req.body||{};if(!['open','in_progress','resolved'].includes(status))return res.status(400).json({error:'Invalid complaint status.'});const c=db.prepare('SELECT * FROM complaints WHERE id=?').get(Number(req.params.id));if(!c)return res.status(404).json({error:'Ticket not found.'});if(req.user.role==='staff'&&req.user.branch_id&&c.branch_id!==req.user.branch_id)return res.status(403).json({error:'You can only update complaints assigned to your branch.'});db.prepare('UPDATE complaints SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,c.id);audit(req.user.id,'update_complaint','complaint',c.id,`Status ${status}`);notify(c.user_id,'Complaint status updated',`Ticket #${c.id} is now ${status.replace('_',' ')}.`);res.json({ok:true});});
app.get('/api/admin/branches',auth,allow('admin'),(req,res)=>res.json({branches:db.prepare('SELECT * FROM branches ORDER BY id').all()}));
app.post('/api/admin/branches',auth,allow('admin'),(req,res)=>{const {name,address,city,service_type}=req.body||{};if(!name||!address||!city||!service_type)return res.status(400).json({error:'All branch fields are required.'});const r=db.prepare('INSERT INTO branches(name,address,city,service_type) VALUES(?,?,?,?)').run(name,address,city,service_type);res.status(201).json({branch:db.prepare('SELECT * FROM branches WHERE id=?').get(r.lastInsertRowid)});});
app.get('/api/admin/users',auth,allow('admin'),(req,res)=>res.json({users:db.prepare('SELECT id,name,email,role,phone,preferred_language,created_at FROM users ORDER BY created_at DESC').all()}));
app.post('/api/admin/users',auth,allow('admin'),(req,res)=>{const {name,email,password,role='staff',phone='',branch_id=null}=req.body||{};if(!name||!email||!password||String(password).length<8||!['staff','admin'].includes(role))return res.status(400).json({error:'Name, email, password (8+ characters), and staff/admin role are required.'});if(branch_id&&!db.prepare('SELECT id FROM branches WHERE id=? AND active=1').get(Number(branch_id)))return res.status(400).json({error:'Active branch not found.'});try{const r=db.prepare('INSERT INTO users(name,email,password_hash,role,phone,branch_id) VALUES(?,?,?,?,?,?)').run(String(name).trim(),String(email).toLowerCase().trim(),bcrypt.hashSync(password,10),role,String(phone),branch_id?Number(branch_id):null);audit(req.user.id,'create_staff_account','user',r.lastInsertRowid,`Role ${role}; branch ${branch_id||'unassigned'}`);res.status(201).json({user:db.prepare('SELECT id,name,email,role,phone,branch_id FROM users WHERE id=?').get(r.lastInsertRowid)});}catch(e){res.status(409).json({error:'An account with this email already exists.'});}});
app.patch('/api/admin/users/:id/branch',auth,allow('admin'),(req,res)=>{const {branch_id}=req.body||{};const user=db.prepare('SELECT id,role FROM users WHERE id=?').get(Number(req.params.id));if(!user)return res.status(404).json({error:'User not found.'});if(user.role!=='staff')return res.status(400).json({error:'Only staff accounts can be assigned to a branch.'});if(branch_id!==null&&branch_id!==undefined&&!db.prepare('SELECT id FROM branches WHERE id=? AND active=1').get(Number(branch_id)))return res.status(400).json({error:'Active branch not found.'});db.prepare('UPDATE users SET branch_id=? WHERE id=?').run(branch_id===null?null:Number(branch_id),user.id);audit(req.user.id,'assign_staff_branch','user',user.id,`Branch ${branch_id??'unassigned'}`);res.json({ok:true,user:db.prepare('SELECT id,name,email,role,branch_id FROM users WHERE id=?').get(user.id)});});
app.get('/api/admin/export.csv',auth,allow('admin','staff'),(req,res)=>{const rows=db.prepare('SELECT a.token,u.name citizen,b.name branch,a.service,a.appointment_date,a.slot,a.status,a.priority,a.estimated_minutes,a.actual_duration_minutes,a.assigned_counter_id FROM appointments a JOIN users u ON u.id=a.user_id JOIN branches b ON b.id=a.branch_id ORDER BY a.appointment_date DESC,a.slot').all();const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv=[Object.keys(rows[0]||{token:'token',name:'citizen',branch:'branch',service:'service',appointment_date:'date',slot:'slot',status:'status',priority:'priority',estimated_minutes:'estimated_minutes'}).join(','),...rows.map(r=>Object.values(r).map(esc).join(','))].join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="skipthequeue-report.csv"');res.send(csv);});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'});});
app.listen(PORT,()=>console.log(`SkipTheQueue is running at http://localhost:${PORT}`));
