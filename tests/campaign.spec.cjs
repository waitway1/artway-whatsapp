const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron } = require('@playwright/test');
const { CustomerStore } = require('../electron/lib/customer-store.cjs');

test('fixed columns, persistent templates and mock success/failure/uncertainty do not miscount contacts', async () => {
 const root=path.resolve(__dirname,'..');
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'artway-bulk-ui-'));
 const customers=new CustomerStore(path.join(userData,'customers.json'));
 customers.createMany([
  {name:'Alpha',country:'澳大利亚',phone:'10000000001',models:['Ford Ranger T9']},
  {name:'Beta',country:'阿联酋',phone:'10000000002',models:['Ford Ranger T9']},
  {name:'Gamma',country:'英国',phone:'10000000003',models:['Ford Ranger T9']},
  {name:'A considerably longer customer company name',country:'新西兰',phone:'10000000004',models:['Jetour T2']},
 ]);
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,ARTWAY_USER_DATA_DIR:userData,ARTWAY_MOCK_BROWSER:'1',ARTWAY_SKIP_CDP:'1'}});
 try {
  const window=await app.firstWindow();
  await window.getByRole('button',{name:'添加账号',exact:true}).first().click();
  await window.getByLabel('账号名称',{exact:true}).fill('Test sales account');
  await window.getByRole('button',{name:'创建并打开',exact:true}).click();
  await expect(window.getByRole('dialog')).toBeHidden();
  await window.getByRole('button',{name:'客户名单',exact:true}).click();
  const bounds=()=>window.getByRole('columnheader').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width})));
  await window.getByRole('button',{name:'筛选车型 Ford Ranger T9',exact:true}).click();
  const first=await bounds();
  await window.getByRole('button',{name:'筛选车型 Jetour T2',exact:true}).click();
  const second=await bounds();
  expect(first).toHaveLength(5);
  for(let i=0;i<5;i++){expect(Math.abs(first[i].x-second[i].x)).toBeLessThan(1);expect(Math.abs(first[i].width-first[0].width)).toBeLessThan(1);}
  await window.getByRole('button',{name:'筛选车型 Ford Ranger T9',exact:true}).click();
  await window.getByRole('button',{name:'群发消息',exact:true}).click();
  await expect(window.getByRole('region',{name:'WhatsApp群发工作区'})).toBeVisible();
  await window.getByRole('textbox',{name:'模板名称',exact:true}).fill('T9 introduction');
  await window.getByRole('textbox',{name:'群发消息内容',exact:true}).fill('Hi, we have automotive accessories.');
  await expect(window.getByRole('checkbox',{name:/选择本车型客户/})).not.toBeChecked();
  await window.getByRole('button',{name:'保存模板',exact:true}).click();
  await expect(window.getByRole('status')).toContainText('消息模板已保存');
  const saved=await window.evaluate(()=>window.artway.campaignState());
  expect(saved.templates).toHaveLength(1);
  await window.reload();
  await window.getByRole('button',{name:'客户名单',exact:true}).click();
  await window.getByRole('button',{name:'群发消息',exact:true}).click();
  await window.getByRole('combobox',{name:'选用模板',exact:true}).selectOption(saved.templates[0].id);
  await expect(window.getByRole('textbox',{name:'群发消息内容',exact:true})).toHaveValue('Hi, we have automotive accessories.');
  await window.getByRole('checkbox',{name:/选择本车型客户/}).check();
  const daysInput=window.getByRole('spinbutton',{name:'跳过联系天数',exact:true});
  await daysInput.fill(''); await expect(daysInput).toHaveValue('7');
  await daysInput.fill('5'); await expect(daysInput).toHaveValue('7');
  await daysInput.press('ArrowDown'); await expect(daysInput).toHaveValue('7');
  const minutesInput=window.getByRole('spinbutton',{name:'发送间隔分钟数',exact:true});
  await minutesInput.fill(''); await expect(minutesInput).toHaveValue('1');
  await minutesInput.fill('0'); await expect(minutesInput).toHaveValue('1');
  await minutesInput.press('ArrowDown'); await expect(minutesInput).toHaveValue('1');
  await daysInput.press('ArrowUp'); await expect(daysInput).toHaveValue('8');
  await minutesInput.press('ArrowUp'); await expect(minutesInput).toHaveValue('2');
  await window.getByRole('spinbutton',{name:'发送间隔分钟数',exact:true}).fill('1');
  await window.screenshot({path:path.join(root,'test-results','bulk-composer.png')});
  await window.getByRole('button',{name:'检查并开始发送',exact:true}).click();
  await window.getByRole('button',{name:'确认开始发送',exact:true}).click();
  await window.getByRole('button',{name:'返回账号',exact:true}).click();
  await expect.poll(async()=>window.evaluate(()=>window.artway.campaignState().then(s=>s.jobs[0]?.status)),{timeout:25000}).toBe('completed');
  const results=await window.evaluate(()=>Promise.all([window.artway.campaignState(),window.artway.listCustomers()]));
  expect(results[0].jobs[0].rows.map(r=>r.status)).toEqual(['succeeded','failed','unconfirmed']);
  expect(results[1].map(c=>c.contactHistory?.length||0)).toEqual([1,0,0,0]);
  expect(results[0].jobs[0].rows[0].contactRecorded).toBe(true);
  await window.getByRole('button',{name:'客户名单',exact:true}).click();
  await expect(window.getByRole('row').filter({hasText:'Alpha'})).toContainText('1 次');
  await window.getByRole('button',{name:'群发消息',exact:true}).click();
  await window.screenshot({path:path.join(root,'test-results','bulk-results.png')});
  await window.getByRole('button',{name:'客户列表',exact:true}).click();
  await window.getByRole('button',{name:'群发消息',exact:true}).click();
  await expect(window.getByRole('checkbox',{name:/选择本车型客户/})).not.toBeChecked();
  await expect(window.getByRole('checkbox',{name:'Alpha（澳大利亚）',exact:true})).toBeDisabled();
  await window.getByRole('checkbox',{name:/选择本车型客户/}).check();
  await expect(window.getByRole('checkbox',{name:'Alpha（澳大利亚）',exact:true})).not.toBeChecked();
  await expect(window.getByRole('checkbox',{name:'Beta（阿联酋）',exact:true})).toBeChecked();
  await window.getByRole('button',{name:'客户列表',exact:true}).click();

  await expect(window.getByRole('row').filter({hasText:'Alpha'})).toContainText('1 次');
  await window.reload();
  const persisted=await window.evaluate(()=>window.artway.listCustomers());
  expect(persisted.map(c=>c.contactHistory?.length||0)).toEqual([1,0,0,0]);
 } finally {await app.close();}
});

test('manual test sending supports saved images and files without creating a customer',async()=>{
 const root=path.resolve(__dirname,'..');
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'artway-manual-ui-'));
 const photo=path.join(userData,'test-image.png');
 fs.writeFileSync(photo,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4OcAAAAASUVORK5CYII=','base64'));
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,ARTWAY_USER_DATA_DIR:userData,ARTWAY_MOCK_BROWSER:'1',ARTWAY_SKIP_CDP:'1',ARTWAY_ATTACHMENT_FILE:photo}});
 try{
  const page=await app.firstWindow();
  await page.getByRole('button',{name:'添加账号',exact:true}).first().click();
  await page.getByLabel('账号名称',{exact:true}).fill('Test sender');
  await page.getByRole('button',{name:'创建并打开',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button',{name:'客户名单',exact:true}).click();
  await page.getByRole('button',{name:'群发消息',exact:true}).click();
  await page.getByRole('button',{name:'输入号码测试',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'任务名称',exact:true})).toHaveCount(0);
  for(const variable of ['{名称}','{国家}','{车型}'])await expect(page.getByRole('button',{name:variable,exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'测试号码',exact:true}).fill('+1 0000000001');
  await page.getByRole('button',{name:'添加图片',exact:true}).click();
  await expect(page.getByRole('region',{name:'WhatsApp群发工作区'}).locator('.bulk-attachments img')).toHaveCount(1);
  await page.getByRole('button',{name:'添加附件',exact:true}).click();
  await expect(page.locator('.bulk-attachments > div')).toHaveCount(2);
  await page.getByRole('textbox',{name:'模板名称',exact:true}).fill('Images and attachments');
  await page.getByRole('button',{name:'保存模板',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('模板已保存');
  const saved=await page.evaluate(()=>window.artway.campaignState());
  expect(saved.templates[0].attachmentIds).toHaveLength(2);
  fs.unlinkSync(photo);
  await page.reload();
  await page.getByRole('button',{name:'客户名单',exact:true}).click();
  await page.getByRole('button',{name:'群发消息',exact:true}).click();
  await page.getByRole('button',{name:'输入号码测试',exact:true}).click();
  await page.getByRole('textbox',{name:'测试号码',exact:true}).fill('10000000001');
  await page.getByRole('combobox',{name:'选用模板',exact:true}).selectOption(saved.templates[0].id);
  await expect(page.locator('.bulk-attachments > div')).toHaveCount(2);
  await page.getByRole('button',{name:'检查并发送测试',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('只发送到测试号码 +10000000001');
  await page.getByRole('button',{name:'确认发送到测试号码',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.artway.campaignState().then(s=>s.jobs[0]?.status)),{timeout:25000}).toBe('completed');
  const result=await page.evaluate(()=>window.artway.campaignState());
  expect(result.jobs[0].rows).toHaveLength(1);
  expect(result.jobs[0].rows[0].status).toBe('succeeded');
  expect(result.jobs[0].rows[0].noCustomerContact).toBe(true);
  expect(result.jobs[0].rows[0].messageId.split(',')).toHaveLength(2);
  expect(await page.evaluate(()=>window.artway.listCustomers())).toEqual([]);
  await page.screenshot({path:path.join(root,'test-results','manual-attachments.png')});
 }finally{await app.close();}
});
