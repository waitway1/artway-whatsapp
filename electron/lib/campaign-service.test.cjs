const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CustomerStore } = require('./customer-store.cjs');
const { CampaignStore, today } = require('./campaign-store.cjs');
const { CampaignService } = require('./campaign-service.cjs');

function setup(send, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artway-campaign-'));
  const customers = new CustomerStore(path.join(directory, 'customers.json'));
  customers.createMany([1,2,3].map(i => ({name:`Customer ${i}`,country:'英国',phone:`44758410924${i}`,models:['Ford Ranger T9']})));
  const store = new CampaignStore(path.join(directory, 'campaigns.json'));
  const service = new CampaignService({store,customers,getAccount:id=>{if(id!=='account')throw new Error('账号不存在');return {id,name:'Sales'};},send,delay:async()=>{},...options});
  const input = {title:'Test',body:'Hello {名称}, {车型}',accountId:'account',customerIds:customers.list().map(c=>c.id),cooldownDays:7,intervalSeconds:60};
  return {directory,customers,store,service,input};
}

test('counts only confirmed successful sends and preserves date-only contact records', async () => {
  let index = 0;
  const context = setup(async (_account,row,onDispatch) => {
    onDispatch();
    return [{status:'succeeded',messageId:'new-server-confirmed-id'},{status:'failed',reason:'Invalid number'},{status:'unconfirmed',reason:'Still pending'}][index++];
  });
  context.service.start(context.input);
  await context.service.task;
  assert.deepEqual(context.service.state().jobs[0].rows.map(r=>r.status),['succeeded','failed','unconfirmed']);
  assert.deepEqual(context.customers.list().map(c=>c.contactHistory?.length || 0),[1,0,0]);
  assert.equal(context.customers.list()[0].contactHistory[0].date,today());
  assert.equal(context.service.state().jobs[0].rows[0].message,'Hello {名称}, {车型}');
});

test('a claimed success without a message id never increments contacts',async()=>{
 const c=setup(async()=>({status:'succeeded'}));c.service.start(c.input);await c.service.task;
 assert.ok(c.customers.list().every(customer=>!customer.contactHistory?.length));
 assert.ok(c.store.snapshot().jobs[0].rows.every(row=>row.status==='unconfirmed'));
});

test('cancellation finishes the in-flight confirmation but never sends remaining customers',async()=>{
 let resolve;
 const c=setup(async(_a,_r,dispatch)=>{dispatch();return new Promise(r=>{resolve=r;});});
 const job=c.service.start(c.input);
 c.service.control(job.id,'cancel');
 resolve({status:'succeeded',messageId:'confirmed'});await c.service.task;
 assert.deepEqual(c.store.snapshot().jobs[0].rows.map(r=>r.status),['succeeded','cancelled','cancelled']);
 assert.deepEqual(c.customers.list().map(c=>c.contactHistory?.length||0),[1,0,0]);
});

test('excludes recent contacts and rechecks deleted or changed customers before sending',async()=>{
 let calls=0;
 const c=setup(async(_a,_r,dispatch)=>{dispatch();calls++;return {status:'succeeded',messageId:'confirmed'};});
 c.customers.recordContact(c.input.customerIds[0]);
 c.input.cooldownDays=7;
 const second=c.input.customerIds[1];
 c.service.delay=async()=>{if(c.customers.list().some(customer=>customer.id===c.input.customerIds[2]))c.customers.remove(c.input.customerIds[2]);};
 c.service.start(c.input);await c.service.task;
 assert.equal(calls,1);
 assert.equal(c.customers.list().find(customer=>customer.id===second).contactHistory.length,1);
 assert.deepEqual(c.store.snapshot().jobs[0].rows.map(r=>r.status),['skipped','succeeded','skipped']);
});

test('restart reconciles successful contacts exactly once and does not retry uncertain messages',async()=>{
 const c=setup(async(_a,_r,dispatch)=>{dispatch();return {status:'succeeded',messageId:'confirmed'};});
 c.service.start(c.input);await c.service.task;
 const job=c.store.snapshot().jobs[0];job.status='running';job.rows[0].contactRecorded=false;job.rows[1].status='sending';job.rows[2].status='pending';c.store.saveJob(job);
 const recovered=new CampaignService({store:new CampaignStore(c.store.file),customers:c.customers,getAccount:()=>({}),send:()=>{throw new Error('Must not resend');}});
 assert.equal(c.customers.list()[0].contactHistory.length,1);
 assert.equal(recovered.state().jobs[0].status,'interrupted');
 assert.deepEqual(recovered.state().jobs[0].rows.map(r=>r.status),['succeeded','unconfirmed','cancelled']);
});

test('message templates survive restart and can be updated and deleted without affecting jobs',()=>{
 const c=setup(async()=>({}));
 const t=c.store.saveTemplate({name:'T9 intro',body:'Hi {名称}'});
 c.store.saveTemplate({id:t.id,name:'T9 intro',body:'Hello {名称} from {国家}'});
 const restarted=new CampaignStore(c.store.file);
 assert.equal(restarted.snapshot().templates[0].body,'Hello {名称} from {国家}');
 assert.throws(()=>restarted.saveTemplate({name:'T9 intro',body:'duplicate'}),/已存在/);
 restarted.removeTemplate(t.id);assert.equal(new CampaignStore(c.store.file).snapshot().templates.length,0);
});

test('pausing waits for in-flight work, then resumes only pending recipients',async()=>{
 let resolve;let calls=0;
 const c=setup(async(_a,_r,dispatch)=>{dispatch();calls++;return calls===1?new Promise(r=>{resolve=r;}):{status:'succeeded',messageId:`id-${calls}`};});
 const job=c.service.start(c.input);c.service.control(job.id,'pause');resolve({status:'succeeded',messageId:'id-1'});await c.service.task;
 assert.equal(calls,1);assert.equal(c.store.snapshot().jobs[0].status,'paused');
 c.service.control(job.id,'resume');await c.service.task;
 assert.equal(calls,3);assert.ok(c.customers.list().every(customer=>customer.contactHistory.length===1));
});

test('stop before dispatch prevents sending the current prepared message',async()=>{
 let attempt;let actuallySent=false;
 const c=setup(async(_account,_row,dispatch)=>new Promise((resolve,reject)=>{attempt=()=>{try{dispatch();actuallySent=true;resolve({status:'succeeded',messageId:'must-not-send'});}catch(error){reject(error);}};}));
 const job=c.service.start(c.input);c.service.control(job.id,'cancel');attempt();await c.service.task;
 assert.equal(actuallySent,false);
 assert.equal(c.store.snapshot().jobs[0].status,'cancelled');
 assert.ok(c.store.snapshot().jobs[0].rows.every(row=>row.status==='cancelled'));
 assert.ok(c.customers.list().every(customer=>!customer.contactHistory?.length));
});

test('manual test numbers do not create customers and count only matching successful contacts',async()=>{
 const c=setup(async(_a,_r,dispatch)=>{dispatch();return {status:'succeeded',messageId:'confirmed'};});
 const input={...c.input,title:undefined,customerIds:[],testPhone:'10000000001',body:'Test only'};
 c.service.start(input);await c.service.task;
 assert.equal(c.customers.list().length,3);assert.ok(c.customers.list().every(customer=>!customer.contactHistory?.length));
 assert.equal(c.store.snapshot().jobs[0].rows[0].noCustomerContact,true);
 c.service.start({...input,testPhone:c.customers.list()[0].phone});await c.service.task;
 assert.equal(c.customers.list()[0].contactHistory.length,1);
 c.customers.remove(c.customers.list()[0].id);
 assert.throws(()=>c.service.start({...input,testPhone:'447584109241'}),/已删除/);
 assert.throws(()=>c.service.start({...input,testPhone:'123'}),/测试号码/);
});

test('image-only templates and jobs work without text or task names',async()=>{
 const c=setup(async(_a,row,dispatch)=>{assert.equal(row.attachments.length,1);dispatch();return {status:'succeeded',messageId:'image-confirmed'};});
 const attachments=[{id:'example',kind:'image',name:'photo.png'}];
 const saved=c.store.saveTemplate({name:'Photo template',body:'',attachments});
 assert.deepEqual(saved.attachmentIds,['example']);
 c.service.start({...c.input,title:undefined,body:'',attachments});await c.service.task;
 assert.ok(c.customers.list().every(customer=>customer.contactHistory.length===1));
});

test('enforces seven days and one minute in the backend',()=>{
 const c=setup(async()=>({}));
 assert.throws(()=>c.service.start({...c.input,cooldownDays:6}),/7–365/);
 assert.throws(()=>c.service.start({...c.input,intervalSeconds:59}),/至少1分钟/);
 c.customers.recordContact(c.input.customerIds[0]);
 const job=c.service.start(c.input);
 assert.equal(job.rows[0].status,'skipped');
 c.service.control(job.id,'cancel');
});

test('manual tests bypass cooldown and delay even for a recently contacted customer',async()=>{
 let delays=0;
 const c=setup(async(_a,_r,dispatch)=>{dispatch();return {status:'succeeded',messageId:'confirmed'};});
 c.service.delay=async()=>{delays++;};
 const customer=c.customers.list()[0];c.customers.recordContact(customer.id);
 const input={...c.input,customerIds:[],testPhone:customer.phone,cooldownDays:0,intervalSeconds:0};
 c.service.start(input);await c.service.task;
 c.service.start(input);await c.service.task;
 assert.equal(c.customers.list()[0].contactHistory.length,3);
 assert.equal(delays,0);
 assert.equal(c.service.state().jobs[0].cooldownDays,0);
 assert.equal(c.service.state().jobs[0].intervalSeconds,0);
 assert.throws(()=>c.service.start({...c.input,cooldownDays:0,intervalSeconds:0}),/7–365/);
});
