const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const IMAGE_TYPES = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
class AttachmentStore {
  constructor(directory) { this.directory = directory; }
  importFile(file, kind) {
    if (!['image','file'].includes(kind)) throw new Error('附件类型无效。');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > 50 * 1024 * 1024) throw new Error('请选择非空文件，单个文件最大 50 MB。');
    const ext = path.extname(file).toLowerCase();
    if (kind === 'image' && !IMAGE_TYPES[ext]) throw new Error('图片支持 PNG、JPG、WEBP、GIF。');
    fs.mkdirSync(this.directory,{recursive:true});
    const id=randomUUID();
    const attachment={id,name:path.basename(file),kind,size:stat.size,extension:ext};
    fs.mkdirSync(path.join(this.directory,id),{recursive:true});
    fs.copyFileSync(file,path.join(this.directory,id,attachment.name));
    fs.writeFileSync(path.join(this.directory,id+'.json'),JSON.stringify(attachment),'utf8');
    return this.resolve(id);
  }
  resolve(id) {
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('附件编号无效。');
    let attachment;
    try{attachment=JSON.parse(fs.readFileSync(path.join(this.directory,id+'.json'),'utf8'));}catch{throw new Error('附件已丢失，请重新添加。');}
    const file=path.join(this.directory,id,attachment.name);
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size!==attachment.size)throw new Error(`附件“${attachment.name}”已变化，请重新添加。`);
    const result={...attachment,path:file};
    if(attachment.kind==='image')result.previewUrl=`data:${IMAGE_TYPES[attachment.extension]};base64,${fs.readFileSync(file).toString('base64')}`;
    return result;
  }
  resolveMany(ids=[]) {
    if(!Array.isArray(ids)||ids.length>10)throw new Error('每次最多添加10个图片或附件。');
    return [...new Set(ids)].map(id=>this.resolve(id));
  }
}
module.exports={AttachmentStore};
