const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {test,expect,_electron}=require('@playwright/test');
test('recognizes current WhatsApp message ids and SVG receipts without counting incoming or old messages',async()=>{
 const root=path.resolve(__dirname,'..');const data=fs.mkdtempSync(path.join(os.tmpdir(),'artway-modern-'));
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,ARTWAY_USER_DATA_DIR:data,ARTWAY_MOCK_BROWSER:'1',ARTWAY_SKIP_CDP:'1'}});
 try{
 const page=await app.firstWindow();
 await page.setContent(`<div id="main"><header><button data-testid="conversation-info-header-button" id="header-1"></button><span data-testid="conversation-info-header-chat-title">Saved contact</span></header><footer><div contenteditable="true" role="textbox"></div></footer><div data-id="old"><span data-testid="tail-out"></span><span class="selectable-text">test</span><div data-testid="msg-meta"><svg><title>wds-ic-read</title></svg></div></div><div data-id="new"><span aria-label="你："></span><span class="selectable-text">test</span><div data-testid="msg-meta"><svg><title>wds-ic-sent</title></svg></div></div></div>`);
 const source=fs.readFileSync(path.join(root,'electron/lib/whatsapp-sender.cjs'),'utf8');
 const functionSource=source.slice(source.indexOf('function inspectChat'),source.indexOf('\nasync function evaluate'));
 const inspect=async(binding,before=['old'])=>page.evaluate(({source,binding,before})=>{const fn=new Function(`${source};return inspectChat;`)();return fn('10000000001','test',before,null,binding);},{source:functionSource,binding,before});
 const binding={phone:'10000000001',title:'Saved contact',headerId:'header-1'};
 expect((await inspect(binding)).messageId).toBe('new');expect((await inspect(binding)).verified).toBe(true);
 expect((await inspect(null)).verified).toBe(false);
 await page.locator('[data-id="new"] svg title').evaluate(n=>n.textContent='ic-clock');expect((await inspect(binding)).messageId).toBe('');
 await page.locator('[data-id="new"] svg title').evaluate(n=>n.textContent='wds-ic-delivered');expect((await inspect(binding)).messageId).toBe('new');
 await page.locator('[data-id="new"] svg title').evaluate(n=>n.textContent='');
 await page.locator('[data-id="new"] [data-testid="msg-meta"]').evaluate(n=>n.setAttribute('aria-label',' 已读 '));
 expect((await inspect(binding)).messageId).toBe('new');
 await page.locator('[data-testid="conversation-info-header-chat-title"]').evaluate(n=>n.textContent='Other contact');expect((await inspect(binding)).verified).toBe(false);
 }finally{await app.close();}
});

test('renames a saved WhatsApp contact before sending, using name and country',async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'artway-contact-sync-'));
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,ARTWAY_USER_DATA_DIR:data,ARTWAY_MOCK_BROWSER:'1',ARTWAY_SKIP_CDP:'1'}});
 try{
 const page=await app.firstWindow();await page.setContent(`<div id="main"><header><button data-testid="conversation-info-header-button" id="h">Info</button><span data-testid="conversation-info-header-chat-title">Old name</span></header><footer><div role="textbox" contenteditable="true"></div></footer></div><div data-testid="drawer-right" style="position:absolute;top:80px"><span>+27 605673261</span><button aria-label="编辑">Edit</button><div id="form" hidden><div data-testid="contact-first-name-input" contenteditable="true">Old name</div><div data-testid="contact-last-name-input" contenteditable="true">Surname</div><div role="button" data-testid="save-contact-btn">Save</div></div></div><script>document.querySelector('[aria-label="编辑"]').onclick=()=>document.querySelector('#form').hidden=false;document.querySelector('[data-testid="save-contact-btn"]').onclick=()=>{document.querySelector('[data-testid="conversation-info-header-chat-title"]').textContent=document.querySelector('[data-testid="contact-first-name-input"]').innerText.trim();document.querySelector('#form').remove();};</script>`);
 const result=await app.evaluate(async({app,BrowserWindow})=>{const sender=process.mainModule.require(app.getAppPath()+'/electron/lib/whatsapp-sender.cjs');return sender.syncContactName(BrowserWindow.getAllWindows()[0].webContents,'27605673261','Max Motorsport 南非',{phone:'27605673261',title:'Old name',headerId:'h'},3000);});
 expect(result.title).toBe('Max Motorsport 南非');
 }finally{await app.close();}
});
