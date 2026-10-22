// Small smoke-test suite. Run with `npm test`.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');

function request(port,method,url,body,token){return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let parsed;try{parsed=JSON.parse(raw)}catch{parsed=raw}resolve({status:res.statusCode,body:parsed});});});req.on('error',reject);if(data)req.write(data);req.end();});}
let child,port=3400+Math.floor(Math.random()*1000),tmp;
test('API smoke test: health, auth, booking and role restrictions', {timeout:20000}, async t=>{
 tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stq-test-'));
 child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DB_FILE:path.join(tmp,'test.db'),JWT_SECRET:'test-secret-for-smoke-tests'},stdio:'ignore'});
 t.after(()=>{if(child&&!child.killed)child.kill();try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}});
 let health;for(let i=0;i<40;i++){try{health=await request(port,'GET','/api/health');if(health.status===200)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.equal(health.status,200);assert.equal(health.body.status,'ok');
 const login=await request(port,'POST','/api/auth/login',{email:'citizen@skipthequeue.demo',password:'Queue@123'});assert.equal(login.status,200);assert.ok(login.body.token);
 const branches=await request(port,'GET','/api/branches',null,login.body.token);assert.equal(branches.status,200);assert.ok(branches.body.branches.length>=1);
 const forbidden=await request(port,'GET','/api/queue',null,login.body.token);assert.equal(forbidden.status,403);
 const appt=await request(port,'POST','/api/appointments',{branch_id:1,service:'General enquiry',appointment_date:'2099-02-10',slot:'09:00',priority:'normal'},login.body.token);assert.equal(appt.status,201);assert.match(appt.body.appointment.token,/^STQ-/);
 const conflict=await request(port,'POST','/api/appointments',{branch_id:1,service:'General enquiry',appointment_date:'2099-02-10',slot:'09:00',priority:'normal'},login.body.token);assert.equal(conflict.status,409);
 const prediction=await request(port,'GET',`/api/predictions/${appt.body.appointment.id}`,null,login.body.token);assert.equal(prediction.status,200);assert.equal(prediction.body.is_prediction,true);assert.ok(prediction.body.service_minutes>=5);
 const citizenForecast=await request(port,'GET','/api/admin/forecast',null,login.body.token);assert.equal(citizenForecast.status,403);
 const admin=await request(port,'POST','/api/auth/login',{email:'admin@skipthequeue.demo',password:'Queue@123'});assert.equal(admin.status,200);
 const forecast=await request(port,'GET','/api/admin/forecast',null,admin.body.token);assert.equal(forecast.status,200);assert.ok(forecast.body.forecast);
 const audit=await request(port,'GET','/api/admin/audit',null,admin.body.token);assert.equal(audit.status,200);assert.ok(Array.isArray(audit.body.audit));
});
