const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AttachmentStore}=require('./message-attachments.cjs');
test('copies attachments into durable storage and preserves filename after original moves',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artway-files-'));
 const source=path.join(dir,'price list.pdf');fs.writeFileSync(source,'test document');
 const store=new AttachmentStore(path.join(dir,'managed'));
 const saved=store.importFile(source,'file');fs.unlinkSync(source);
 const loaded=new AttachmentStore(store.directory).resolve(saved.id);
 assert.equal(loaded.name,'price list.pdf');assert.equal(path.basename(loaded.path),'price list.pdf');assert.equal(fs.readFileSync(loaded.path,'utf8'),'test document');
 assert.throws(()=>store.resolve('../outside'),/无效/);
 assert.throws(()=>store.resolveMany(Array(11).fill(saved.id)),/10/);
 fs.writeFileSync(loaded.path,'changed');assert.throws(()=>store.resolve(saved.id),/变化/);
});
