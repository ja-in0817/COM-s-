const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const REQUIRED_ARRAYS=['groups','joined','saved','votes','notices','attendance','reports','careCases','aidQueue','conductCases','moderationLog'];
function validateState(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||s.version!==1||typeof s.nickname!=='string'||s.nickname.length>20)throw Object.assign(new Error('Invalid state header'),{status:422});
 for(const key of REQUIRED_ARRAYS)if(!Array.isArray(s[key])||s[key].length>10000)throw Object.assign(new Error('Invalid state collection: '+key),{status:422});
 if(s.groups.some(g=>!g||typeof g.id!=='string'||!Array.isArray(g.members)))throw Object.assign(new Error('Invalid group'),{status:422});
 return s;
}
class StateStore{
 constructor(file){this.file=file;this.chain=Promise.resolve();this.record={revision:0,state:null}}
 async init(){try{const data=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Number.isInteger(data.revision)||data.revision<0)throw Error('Invalid revision');if(data.state!==null)validateState(data.state);this.record=data}catch(e){if(e.code!=='ENOENT')throw e}return this}
 read(){return structuredClone(this.record)}
 write(state,expectedRevision){const snapshot=structuredClone(validateState(state));
  const op=this.chain.then(async()=>{if(expectedRevision!==this.record.revision)throw Object.assign(new Error('State revision conflict'),{status:409});const next={revision:this.record.revision+1,state:snapshot};await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,this.file);this.record=next;return this.read()}finally{await fs.rm(temp,{force:true}).catch(()=>{})}});this.chain=op.catch(()=>{});return op;
 }
}
module.exports={StateStore,validateState};
