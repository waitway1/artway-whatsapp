// The adapter operates only on the selected account's WhatsApp view. It never
// treats inserting text, clicking Send, or an unacknowledged clock as success.
function inspectChat(phone, body = '', before = [], attachment = null, binding = null) {
  const root = document.querySelector('#main');
  const composer = root?.querySelector('footer [contenteditable="true"][role="textbox"]');
  const dialog = document.querySelector('[role="dialog"]')?.innerText || '';
  const invalid = /电话号码.*(?:无效|不在)|号码.*未.*注册|phone number.*invalid|isn.t on WhatsApp|not on WhatsApp/i.test(dialog);
  const login = !composer && !!document.querySelector('div[data-ref], canvas[aria-label]') && /log in|scan|扫描|登录/i.test(document.body.innerText);
  const header = root?.querySelector('header');
  const labels = [...(header?.querySelectorAll('[title]') || [])].map(n => n.getAttribute('title'));
  if (header) labels.push(header.innerText.split('\n')[0]);
  const identities = [...(root?.querySelectorAll('[data-id]') || [])].map(n => n.getAttribute('data-id')?.match(/^(?:true|false)_(\d+)@(?:c\.us|s\.whatsapp\.net)_/)?.[1]).filter(Boolean);
  const title = header?.querySelector('[data-testid="conversation-info-header-chat-title"]')?.textContent?.trim() || header?.innerText.split('\n')[0]?.trim() || '';
  const headerId = header?.querySelector('[data-testid="conversation-info-header-button"]')?.id || '';
  const verified = labels.some(value => String(value).replace(/\D/g, '') === phone) || identities.includes(phone) || !!(binding && binding.phone === phone && binding.title === title && binding.headerId === headerId && title);
  const normalized = value => String(value).replace(/\s+/g, ' ').trim();
  const allMessages = [...(root?.querySelectorAll('[data-id]') || [])];
  const statusTitles = node => [...node.querySelectorAll('[data-testid="msg-meta"] svg title')].map(title => title.textContent);
  const statusLabels = node => [node, ...node.querySelectorAll('[data-testid="msg-meta"], [data-testid="msg-meta"] [aria-label], [data-testid="msg-meta"] [data-icon]')].map(item => item.getAttribute?.('aria-label') || item.getAttribute?.('data-icon') || '').filter(Boolean);
  const outgoing = allMessages.filter(node => node.getAttribute('data-id').startsWith('true_') || node.querySelector('[data-testid="tail-out"], .message-out, [aria-label="你："], [aria-label="You:"]') || statusTitles(node).some(title => ['wds-ic-sent','wds-ic-delivered','wds-ic-read','ic-sent','ic-delivered','ic-read','ic-clock'].includes(title)) || statusLabels(node).some(label => /sent|delivered|read|已发送|已送达|已读|clock|等待/i.test(label)));
  const candidates = outgoing.filter(n => !before.includes(n.getAttribute('data-id')) && (attachment ? attachment.kind === 'image' ? !!n.querySelector('img, [data-testid*="media"], [data-testid*="image"], [data-testid="image-thumb"]') : n.innerText.includes(attachment.name) : normalized(n.querySelector('.selectable-text, [data-testid="selectable-text"]')?.innerText || '') === normalized(body)));
  const message = candidates.length === 1 ? candidates[0] : null;
  const acknowledged = message && (message.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"]') || statusTitles(message).some(title => ['wds-ic-sent','wds-ic-delivered','wds-ic-read','ic-sent','ic-delivered','ic-read'].includes(title)) || statusLabels(message).some(label => /sent|delivered|read|已发送|已送达|已读/i.test(label)));
  const failed = message?.querySelector('[data-icon="msg-error"], [data-testid="msg-error"]');
  const sendButton = root?.querySelector('footer [data-icon="send"]')?.closest('button, [role="button"]') || [...(root?.querySelectorAll('footer button, footer [role="button"]') || [])].find(button => /^(send|发送)$/i.test(button.getAttribute('aria-label') || '') || [...button.querySelectorAll('svg title')].some(title=>/^(?:wds-)?ic-send(?:-filled)?$/.test(title.textContent)));
  return {
    online: navigator.onLine, invalid, login, verified, composer: !!composer, title, headerId,
    draft: composer?.innerText || '', canSend: !!sendButton && !sendButton.disabled,
    ids: allMessages.map(n => n.getAttribute('data-id')),
    messageId: acknowledged ? message.getAttribute('data-id') : '', failed: !!failed,
  };
}

async function evaluate(contents, fn, ...args) {
  if (contents.isDestroyed()) throw new Error('账号浏览器已关闭');
  if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
  const expression = `(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(',')})`;
  const result = await contents.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('WhatsApp 页面暂不可操作，请检查登录状态');
  return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WhatsApp 页面加载超时，请检查网络后重试')), ms); })]); }
  finally { clearTimeout(timer); }
}

async function verifyNamedRecipient(contents, phone, timeout = 15000) {
  const opened = await evaluate(contents, () => {
    const button = [...document.querySelectorAll('button')].find(node => /^(新聊天|New chat)$/i.test(node.getAttribute('aria-label') || ''));
    if (!button) return false;
    button.click(); return true;
  });
  if (!opened) throw new Error('无法找到 WhatsApp 新聊天入口，不能核验已保存名称的号码。');
  await wait(700);
  let inputReady = false;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    inputReady = await evaluate(contents, () => {
      const drawer = [...document.querySelectorAll('[data-testid="new-chat-drawer"], [data-testid="drawer-left"]')].find(n=>n.querySelector('input[role="textbox"], [contenteditable="true"]'));
      const input = drawer?.querySelector('input[role="textbox"], [contenteditable="true"]');
      if (!input) {
        const button = [...document.querySelectorAll('button')].find(node => /^(新聊天|New chat)$/i.test(node.getAttribute('aria-label') || ''));
        button?.click();
        return false;
      }
      input.focus();
      if (input.tagName === 'INPUT') input.select();
      else { const range = document.createRange(); range.selectNodeContents(input); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      return true;
    });
    if (inputReady) break;
    await wait(150);
  }
  if (!inputReady) throw new Error('号码搜索输入框未就绪。');
  await contents.insertText(phone);
  let match = '';
  let stableSince = 0;
  while (Date.now() - start < timeout) {
    const found = await evaluate(contents, expected => {
      const drawer = [...document.querySelectorAll('[data-testid="new-chat-drawer"], [data-testid="drawer-left"]')].find(n=>n.querySelector('input[role="textbox"], [contenteditable="true"]'));
      const input = drawer?.querySelector('input[role="textbox"], [contenteditable="true"]');
      if ((input?.value ?? input?.innerText)?.trim() !== expected) return '';
      const rows = [...(drawer?.querySelectorAll('[data-testid="cell-frame-container"]') || [])].filter(node => node.getBoundingClientRect().width > 0);
      const names = [...new Set(rows.map(row => row.querySelector('[data-testid="cell-frame-title"]')?.innerText.trim()).filter(Boolean))];
      return names.length === 1 ? names[0] : '';
    }, phone);
    if (found && found === match && Date.now() - stableSince > 600) break;
    if (found !== match) { match = found; stableSince = Date.now(); }
    await wait(200);
  }
  if (!match || Date.now() - start >= timeout) throw new Error('此号码未返回唯一的联系人结果，消息未发送。');
  const selected = await evaluate(contents, (expected, name) => {
    const drawer = [...document.querySelectorAll('[data-testid="new-chat-drawer"], [data-testid="drawer-left"]')].find(n=>n.querySelector('input[role="textbox"], [contenteditable="true"]'));
    const input = drawer?.querySelector('input[role="textbox"], [contenteditable="true"]');
    const rows = [...(drawer?.querySelectorAll('[data-testid="cell-frame-container"]') || [])].filter(node => node.getBoundingClientRect().width > 0);
    const matches = rows.filter(row => row.querySelector('[data-testid="cell-frame-title"]')?.innerText.trim() === name);
    const names = new Set(rows.map(row => row.querySelector('[data-testid="cell-frame-title"]')?.innerText.trim()).filter(Boolean));
    if ((input?.value ?? input?.innerText)?.trim() !== expected || !matches.length || names.size !== 1) return false;
    const rect = matches[0].getBoundingClientRect();
    return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
  }, phone, match);
  if (!selected) throw new Error('号码搜索结果发生变化，已停止发送。');
  await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:selected.x,y:selected.y,button:'left',clickCount:1});
  await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:selected.x,y:selected.y,button:'left',clickCount:1});
  while (Date.now() - start < timeout) {
    const state = await evaluate(contents, inspectChat, phone);
    if(state.composer && state.title && state.title!==match && !await evaluate(contents,()=>[...document.querySelectorAll('[data-testid="new-chat-drawer"]')].some(n=>n.getBoundingClientRect().width&&n.innerText.trim()))){
      await nativeClick(contents,'[data-testid="conversation-info-header-button"]');
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        const correct=await evaluate(contents,expected=>[...document.querySelectorAll('[data-testid="drawer-right"]')].some(n=>n.getBoundingClientRect().width&&n.innerText.replace(/\D/g,'').includes(expected)),phone);
        if(correct){
          await evaluate(contents,()=>document.querySelector('[data-testid="drawer-right"] button[aria-label="关闭"], [data-testid="drawer-right"] button[aria-label="Close"]')?.click());
          return {phone,title:state.title,headerId:state.headerId};
        }
        await wait(200);
      }
      throw new Error('用户名搜索结果对应的电话号码无法核实，消息未发送。');
    }
    if (state.composer && state.title.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim() === match.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim() && !await evaluate(contents, () => [...document.querySelectorAll('[data-testid="drawer-left"]')].some(n => n.getBoundingClientRect().width && /新聊天|New chat/.test(n.innerText.slice(0,30))))) {
      return { phone, title: state.title, headerId: state.headerId };
    }
    await wait(200);
  }
  const diagnostic=await evaluate(contents,inspectChat,phone);
  throw new Error('号码对应的会话尚未就绪，消息未发送。'+JSON.stringify({match,title:diagnostic.title,composer:diagnostic.composer}));
}

async function prepareRecipient(contents, phone, {mockUrl, readyTimeout = 45000} = {}) {
  const initial = await evaluate(contents, inspectChat, phone);
  if (initial.draft.trim()) throw new Error('所选账号有未发送草稿，请先处理草稿再继续任务。');
  if (initial.composer && initial.verified) return null;
  if (!mockUrl && await evaluate(contents,()=>!!document.querySelector('button[aria-label="新聊天"],button[aria-label="New chat"]'))) {
    try { return await verifyNamedRecipient(contents, phone, Math.min(readyTimeout,15000)); }
    catch (error) {
      // A username-directory result may not open as a normal contact. Only
      // this unsupported branch falls back to WhatsApp's explicit phone route.
      if (!/会话尚未就绪|唯一的联系人/.test(error.message)) throw error;
    }
  }
  await bounded(contents.loadURL(mockUrl ? `${mockUrl}?phone=${phone}` : `https://web.whatsapp.com/send?phone=${phone}`), readyTimeout);
  const start = Date.now();
  while (Date.now() - start < readyTimeout) {
    const state = await evaluate(contents, inspectChat, phone);
    if (state.invalid) throw new Error('此号码无法在 WhatsApp 中打开会话。');
    if (!state.online || state.login) throw new Error(state.login ? '账号未登录，请先扫码登录。' : '账号网络已断开，请检查连接。');
    if (state.composer && state.verified) return null;
    if (state.composer && state.title) return verifyNamedRecipient(contents, phone, Math.max(15000, readyTimeout - (Date.now() - start)));
    await wait(300);
  }
  throw new Error('会话输入框未就绪，请检查账号登录或网络连接。');
}

async function nativeClick(contents, selector, timeout=10000) {
  const deadline=Date.now()+timeout;
  let previous=null;
  while(Date.now()<deadline){
    const point=await evaluate(contents,selector=>{
      const nodes=[...document.querySelectorAll(selector)].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&!n.closest('[inert],[aria-hidden="true"]')&&!n.disabled&&n.getAttribute('aria-disabled')!=='true');
      for(const node of nodes){
        node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        const r=node.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;
        const hit=document.elementFromPoint(x,y);
        if(hit&&(hit===node||node.contains(hit)))return {x,y};
      }
      return null;
    },selector);
    if(point&&previous&&Math.abs(point.x-previous.x)<1&&Math.abs(point.y-previous.y)<1){
      for(const type of ['mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
      return;
    }
    previous=point;await wait(150);
  }
  throw new Error(`联系人控件不可点击（${selector}），尚未发送。`);
}

async function syncContactName(contents, phone, desiredName, binding, timeout=45000) {
  await nativeClick(contents,'[data-testid="conversation-info-header-button"]');
  const start=Date.now();
  let action;
  let lastOpen = Date.now();
  while(Date.now()-start<timeout){
    if (Date.now() - lastOpen > 1500) {
      await evaluate(contents,()=>{
        const panels=[...document.querySelectorAll('[data-testid="drawer-right"]')];
        if(!panels.some(n=>n.getBoundingClientRect().width>0&&n.innerText.trim()))document.querySelector('[data-testid="conversation-info-header-button"]')?.click();
      });
      lastOpen=Date.now();
    }
    action=await evaluate(contents,(phone)=>{
      const drawer=[...document.querySelectorAll('[data-testid="drawer-right"]')].find(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&n.innerText.replace(/\D/g,'').includes(phone));
      if(!drawer||!drawer.innerText.replace(/\D/g,'').includes(phone))return null;
      document.querySelectorAll('[data-artway-contact-action]').forEach(n=>n.removeAttribute('data-artway-contact-action'));
      const buttons=[...drawer.querySelectorAll('button,[role="button"]')].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
      const edit=buttons.find(n=>/^(编辑|Edit)$/i.test(n.getAttribute('aria-label')||''));
      const add=buttons.find(n=>/^(添加|添加到联系人|添加联系人|保存联系人|Add|Add to contacts|Save contact)$/i.test((n.getAttribute('aria-label')||n.innerText).trim()));
      const node=edit||add;
      if(!node)return null;
      node.setAttribute('data-artway-contact-action','true');return {edit:!!edit};
    },phone);
    if(action)break;await wait(200);
  }
  if(!action)throw new Error('无法读取联系人号码或新增/编辑入口，本条未发送。');
  if(action.edit){
    const state=await evaluate(contents,inspectChat,phone,'',[],null,binding);
    if(state.title===desiredName){await evaluate(contents,()=>document.querySelector('[data-testid="drawer-right"] button[aria-label="关闭"], [data-testid="drawer-right"] button[aria-label="Close"]')?.click());return binding||{phone,title:state.title,headerId:state.headerId};}
  }
  await nativeClick(contents,'[data-artway-contact-action="true"]');
  while(Date.now()-start<timeout){
    if(await evaluate(contents,()=>!!document.querySelector('[data-testid="contact-first-name-input"]')))break;
    await wait(200);
  }
  for(const [selector,value] of [['[data-testid="contact-first-name-input"]',desiredName],['[data-testid="contact-last-name-input"]','']]){
    let matched=false;
    for(let attempt=0;attempt<3&&!matched;attempt++){
      await nativeClick(contents,selector);
      // Lexical restores its own selection after focus. Use Chromium's editing
      // command rather than a DOM Range followed immediately by Backspace.
      await wait(150);
      await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2,commands:['selectAll']});
      await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await wait(100);
      if(value)await contents.insertText(value);
      await wait(200);
      matched=await evaluate(contents,(selector,value)=>{
        const node=document.querySelector(selector);
        const normalize=text=>String(text||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim();
        return !!node&&normalize(node.innerText)===normalize(value);
      },selector,value);
    }
    if(!matched)throw new Error('联系人姓名输入未生效，已停止发送；请检查联系人编辑页。');
  }
  let save=false;
  const saveDeadline=Date.now()+10000;
  while(!save&&Date.now()<saveDeadline){
    save=await evaluate(contents,()=>{
      document.querySelectorAll('[data-artway-contact-save]').forEach(n=>n.removeAttribute('data-artway-contact-save'));
      const nodes=[...document.querySelectorAll('[data-testid="save-contact-drawer"] [data-testid="save-contact-btn"], [data-testid="drawer-right"] [data-testid="save-contact-btn"], [data-testid="save-contact-drawer"] button, [data-testid="save-contact-drawer"] [role="button"], [data-testid="drawer-right"] button, [data-testid="drawer-right"] [role="button"]')];
      const node=nodes.find(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&!n.disabled&&n.getAttribute('aria-disabled')!=='true'&&(n.getAttribute('data-testid')==='save-contact-btn'||/^(保存|保存联系人|Save|Save contact)$/i.test((n.getAttribute('aria-label')||n.innerText).trim())));
      if(!node)return false;node.setAttribute('data-artway-contact-save','true');return true;
    });
    if(!save)await wait(200);
  }
  if(!save){
    // Saving is unnecessary if both stored fields already match the target.
    const same=await evaluate(contents,desired=>{
      const first=document.querySelector('[data-testid="contact-first-name-input"]');
      const last=document.querySelector('[data-testid="contact-last-name-input"]');
      return first?.innerText.trim()===desired&&!last?.innerText.trim()&&document.querySelector('#main header [data-testid="conversation-info-header-chat-title"]')?.innerText.trim()===desired;
    },desiredName);
    if(same){for(const type of ['keyDown','keyUp'])await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});return {phone,title:desiredName,headerId:(await evaluate(contents,inspectChat,phone)).headerId};}
    throw new Error('联系人保存按钮未就绪，未发送。');
  }
  await nativeClick(contents,'[data-artway-contact-save="true"]');
  const savedAt=Date.now();
  while(Date.now()-savedAt<timeout){
    const state=await evaluate(contents,inspectChat,phone,'',[],null,binding);
    if(state.title===desiredName&&!await evaluate(contents,()=>[...document.querySelectorAll('[data-testid="contact-first-name-input"]')].some(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0))){
      await evaluate(contents,()=>document.querySelector('[data-testid="drawer-right"] button[aria-label="关闭"], [data-testid="drawer-right"] button[aria-label="Close"]')?.click());
      return {phone,title:state.title,headerId:state.headerId};
    }
    await wait(250);
  }
  throw new Error('联系人名称保存后未得到确认，消息未发送。');
}

async function sendWhatsAppMessage(contents, row, onDispatch, { mockUrl, readyTimeout = 45000, ackTimeout = 45000 } = {}) {
  let dispatched = false;
  try {
    let binding = await prepareRecipient(contents, row.phone, {mockUrl,readyTimeout});
    if(row.contactName&&!mockUrl)binding=await syncContactName(contents,row.phone,row.contactName,binding);
    let state = await evaluate(contents, inspectChat, row.phone, '', [], null, binding);
    if (state.draft.trim()) return { status: 'failed', fatal: true, reason: '此客户会话已有未发送草稿，请先处理。' };
    const parts = row.attachments?.length
      ? [...(row.message ? [{body: row.message}] : []), ...row.attachments.map(attachment => ({ attachment }))]
      : (row.message ? [{body:row.message}] : []);
    const confirmedIds=[];
    for(const part of parts) {
      state=await evaluate(contents,inspectChat,row.phone,'',[],null,binding);
      if(!state.verified)throw new Error('收件人核验失败。');
      const before=state.ids;
      if(part.attachment) {
        await uploadAttachment(contents,part.attachment,!!mockUrl);
      } else {
        await evaluate(contents, () => { document.querySelector('#main footer [contenteditable="true"][role="textbox"]').focus(); });
        await contents.insertText(part.body);
        state=await evaluate(contents,inspectChat,row.phone,'',[],null,binding);
        if(state.draft.replace(/\s+/g,' ').trim()!==part.body.replace(/\s+/g,' ').trim())throw new Error('发送前文字校验失败。');
      }
      onDispatch();
      dispatched=true;
      const clicked=await evaluate(contents,(media)=>{
        const scopes=media?[...document.querySelectorAll('[role="dialog"], [data-animate-modal-popup="true"]'),document]:[document.querySelector('#main footer')];
        for(const scope of scopes){
          const buttons=[...(scope?.querySelectorAll('[data-icon="send"]') || [])].map(icon=>icon.closest('button,[role="button"]'));
          buttons.push(...(scope?.querySelectorAll('button[aria-label="Send"],button[aria-label="发送"],[role="button"][aria-label^="发送"],[role="button"][aria-label^="Send"]') || []));
          buttons.push(...[...(scope?.querySelectorAll('svg title') || [])].filter(title=>/^(?:wds-)?ic-send(?:-filled)?$/.test(title.textContent)).map(title=>title.closest('button,[role="button"]')));
          const button=buttons.find(button=>button&&!button.disabled&&button.getBoundingClientRect().width&&(!media||!button.closest('#main footer')));
          if(button&&!button.disabled&&button.getBoundingClientRect().width){const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};}
        }
        return false;
      },!!part.attachment);
      if(!clicked)throw new Error('未找到可用发送按钮。');
      await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:clicked.x,y:clicked.y,button:'left',clickCount:1});
      await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:clicked.x,y:clicked.y,button:'left',clickCount:1});
      // WhatsApp occasionally consumes the click while the composer is still
      // focused. If the text remains as a draft and no new outgoing bubble
      // appeared, use the native Enter action as a single guarded fallback.
      if (!part.attachment) {
        await wait(600);
        const stillDraft = await evaluate(contents, (body, beforeIds) => {
          const composer = document.querySelector('#main footer [contenteditable="true"][role="textbox"]');
          const ids = [...document.querySelectorAll('#main [data-id]')].map(n => n.getAttribute('data-id'));
          return !!composer?.innerText?.trim() && ids.every(id => beforeIds.includes(id));
        }, part.body, before);
        if (stillDraft) {
          await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
          await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        }
      }
      const sentAt=Date.now();let confirmed=false;
      while(Date.now()-sentAt<ackTimeout){
        state=await evaluate(contents,inspectChat,row.phone,part.body||'',before,part.attachment?{kind:part.attachment.kind,name:part.attachment.name}:null,binding);
        if(state.messageId){confirmedIds.push(state.messageId);confirmed=true;break;}
        if(state.failed)return {status:confirmedIds.length?'unconfirmed':'failed',reason:`${confirmedIds.length?'部分内容已成功；':''}WhatsApp 显示发送失败，本次不记录联系。`};
        if(!state.online||state.login)throw new Error('连接中断，结果待核实。');
        await wait(300);
      }
      if(!confirmed)return {status:'unconfirmed',reason:`${confirmedIds.length ? `已有${confirmedIds.length}条内容成功；` : ''}其余发送结果未确认，不记录联系，不会自动重发。`};
    }
    return {status:'succeeded',messageId:confirmedIds.join(',')};
  } catch (error) {
    try { await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); } catch {}
    return { status: dispatched ? 'unconfirmed' : 'failed', fatal: true, reason: error.message };
  }
}
async function uploadAttachment(contents, attachment, testPage = false) {
  // Intercept before the menu click: setting files via DOM does not close a
  // native Windows picker that WhatsApp has already opened.
  let chooser = null;
  const onChooser = (_event, method, params) => { if (method === 'Page.fileChooserOpened') chooser = params; };
  contents.debugger.on('message', onChooser);
  await contents.debugger.sendCommand('Page.enable');
  await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
  try {
    return await uploadAttachmentFile(contents, attachment, testPage, () => chooser);
  } finally {
    contents.debugger.removeListener('message', onChooser);
    if (!contents.isDestroyed() && contents.debugger.isAttached()) {
      await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
    }
  }
}

async function uploadAttachmentFile(contents, attachment, testPage = false, getChooser = () => null) {
  const fs=require('node:fs');
  if(!fs.existsSync(attachment.path))throw new Error(`附件“${attachment.name}”已丢失。`);
  if(!testPage) await evaluate(contents,()=>{
    const button=document.querySelector('#main footer button[aria-label="附加"],#main footer button[aria-label="Attach"],#main footer [data-icon="plus-rounded"],#main footer [data-icon="clip"]')?.closest('button,[role="button"]');
    if(!button) return false; button.click(); return true;
  });
  if(!testPage) await wait(350);
  const menuClicked=testPage || await (async()=>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      const point=await evaluate(contents,kind=>{
        const terms=kind==='image'?/照片和视频|照片与视频|Photos\s*(?:and|&)\s*Videos|Photos/i:/文档|文件|Document/i;
        const nodes=[...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] [role="button"], [data-testid*="attach"] button, [data-testid*="attach"] [role="button"]')].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
        const node=nodes.find(n=>terms.test((n.innerText||n.getAttribute('aria-label')||'').trim()));
        if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      },attachment.kind);
      if(point){
        for(const type of ['mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
        return true;
      }
      await wait(200);
    }
    return false;
  })();
  if(!menuClicked)throw new Error(`未找到“${attachment.kind==='image'?'照片和视频':'文档'}”入口，图片未发送。`);
  await wait(testPage?0:350);
  await contents.debugger.sendCommand('DOM.enable');
  if (!testPage) {
    const deadline = Date.now() + 5000;
    while (!getChooser() && Date.now() < deadline) await wait(100);
    const chooser = getChooser();
    if (!chooser?.backendNodeId) throw new Error('未捕获本次照片/文档选择入口，已停止上传，避免使用贴图入口。');
    const {node} = await contents.debugger.sendCommand('DOM.describeNode', {backendNodeId: chooser.backendNodeId});
    const attrs = Object.fromEntries(Array.from({length: (node.attributes || []).length / 2}, (_,i) => [node.attributes[i*2], node.attributes[i*2+1]]));
    if (attachment.kind === 'image' && (!/video/.test(attrs.accept || '') || !Object.hasOwn(attrs,'multiple'))) throw new Error('本次文件入口不是照片和视频，已停止上传。');
    await contents.debugger.sendCommand('DOM.setFileInputFiles', {backendNodeId: chooser.backendNodeId, files: [attachment.path]});
  } else {
    const documentNode=await contents.debugger.sendCommand('DOM.getDocument',{});
    const selector=attachment.kind==='image'?'input[type="file"][multiple]':'input[type="file"]:not([accept])';
    const {nodeId}=await contents.debugger.sendCommand('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector});
    if(!nodeId)throw new Error('测试附件入口不可用。');
    await contents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[attachment.path]});
  }
  const start=Date.now();
  while(Date.now()-start<20000){
    const ready=await evaluate(contents,()=>{
      return [...document.querySelectorAll('[data-icon="send"],button[aria-label="Send"],button[aria-label="发送"]')].some(icon=>!icon.closest('#main footer')&&icon.getBoundingClientRect().width>0) || [...document.querySelectorAll('svg title')].some(title=>/^(?:wds-)?ic-send(?:-filled)?$/.test(title.textContent)&&!title.closest('#main footer')&&title.closest('svg').getBoundingClientRect().width>0);
    });
    if(ready)return;
    await wait(250);
  }
  throw new Error('附件预览未就绪，没有发送此附件。');
}

module.exports = { sendWhatsAppMessage, inspectChat, prepareRecipient, syncContactName, evaluate, uploadAttachment };
