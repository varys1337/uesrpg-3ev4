"use strict";

// Read-only inspection of the manifest-selected LevelDB tables and write-ahead log.
// This module never opens a database or creates its locks/logs. Pack writes belong
// to the documented Foundry Document APIs in the isolated authoring world.

const fs=require("node:fs"), path=require("node:path");
const ROOT=path.resolve(__dirname, "../..");
function variable(buffer,state){let n=0n,s=0n;for(;;){if(state.p>=buffer.length)throw Error("truncated varint");const x=buffer[state.p++];n|=BigInt(x&127)<<s;if(!(x&128))return Number(n);s+=7n;if(s>63n)throw Error("bad varint");}}
function bytes(buffer,state){const n=variable(buffer,state);const out=buffer.subarray(state.p,state.p+n);state.p+=n;return out;}
function logRecords(buffer){let out=[],parts=[];for(let p=0;p+7<=buffer.length;){if(p%32768>32761){p+=32768-p%32768;continue;}let size=buffer.readUInt16LE(p+4),type=buffer[p+6];p+=7;if(!type&&!size)continue;const chunk=buffer.subarray(p,p+size);p+=size;if(type===1)out.push(chunk);else if(type===2)parts=[chunk];else if(type===3)parts.push(chunk);else if(type===4){parts.push(chunk);out.push(Buffer.concat(parts));parts=[];}}return out;}
function liveFiles(dir){const current=fs.readFileSync(path.join(dir,"CURRENT"),"utf8").trim();const active=new Map();let log=0,prevLog=0;for(const rec of logRecords(fs.readFileSync(path.join(dir,current)))){const s={p:0};while(s.p<rec.length){const tag=variable(rec,s);if(tag===1)bytes(rec,s);else if(tag===2)log=variable(rec,s);else if(tag===9)prevLog=variable(rec,s);else if(tag===3||tag===4)variable(rec,s);else if(tag===5){variable(rec,s);bytes(rec,s);}else if(tag===6){variable(rec,s);active.delete(variable(rec,s));}else if(tag===7){const level=variable(rec,s),num=variable(rec,s),size=variable(rec,s);bytes(rec,s);bytes(rec,s);active.set(num,{level,num,size});}else throw Error("unknown manifest tag "+tag);}}
return {tables:[...active.values()].map(x=>path.join(dir,String(x.num).padStart(6,"0")+".ldb")), logs:[log,prevLog].filter(x=>x>0).map(x=>path.join(dir,String(x).padStart(6,"0")+".log")).filter(x=>fs.existsSync(x))};}
function unsnappy(buffer){const s={p:0},length=variable(buffer,s),out=Buffer.alloc(length);let p=0;while(s.p<buffer.length){const tag=buffer[s.p++],type=tag&3;let n,offset;if(type===0){n=tag>>2;if(n<60)n++;else{const size=n-59;n=0;for(let i=0;i<size;i++)n+=buffer[s.p++]*2**(8*i);n++;}buffer.copy(out,p,s.p,s.p+n);s.p+=n;p+=n;}else{if(type===1){n=4+((tag>>2)&7);offset=((tag&224)<<3)|buffer[s.p++];}else if(type===2){n=1+(tag>>2);offset=buffer.readUInt16LE(s.p);s.p+=2;}else{n=1+(tag>>2);offset=buffer.readUInt32LE(s.p);s.p+=4;}if(offset<=0||offset>p)throw Error("bad snappy offset");for(let i=0;i<n;i++)out[p+i]=out[p+i-offset];p+=n;}}
if(p!==length)throw Error("bad snappy length");return out;}
function block(buffer,handle){const type=buffer[handle.offset+handle.size],data=buffer.subarray(handle.offset,handle.offset+handle.size);if(type===0)return data;if(type===1)return unsnappy(data);throw Error("unknown compression "+type);}
function handle(buffer,state={p:0}){return {offset:variable(buffer,state),size:variable(buffer,state)};}
function entries(buffer){const count=buffer.readUInt32LE(buffer.length-4),end=buffer.length-4-count*4,s={p:0},out=[];let key=Buffer.alloc(0);while(s.p<end){const common=variable(buffer,s),suffix=variable(buffer,s),len=variable(buffer,s);key=Buffer.concat([key.subarray(0,common),buffer.subarray(s.p,s.p+suffix)]);s.p+=suffix;const value=buffer.subarray(s.p,s.p+len);s.p+=len;out.push({key,value});}return out;}
function readPack(relative){const dir=path.resolve(ROOT,relative),files=liveFiles(dir),latest=new Map();
function add(key,value,sequence,type){const old=latest.get(key);if(!old||sequence>old.sequence)latest.set(key,{sequence,type,value});}
for(const file of files.tables){const buffer=fs.readFileSync(file);if(buffer.subarray(buffer.length-8).toString("hex")!=="57fb808b247547db")throw Error("bad table magic");const foot={p:buffer.length-48};handle(buffer,foot);const idx=block(buffer,handle(buffer,foot));for(const entry of entries(idx)){for(const row of entries(block(buffer,handle(entry.value)))){const packed=row.key.readBigUInt64LE(row.key.length-8);add(row.key.subarray(0,row.key.length-8).toString(),row.value,packed>>8n,Number(packed&255n));}}}
for(const file of files.logs){for(const rec of logRecords(fs.readFileSync(file))){if(rec.length<12)continue;let sequence=rec.readBigUInt64LE(0);const count=rec.readUInt32LE(8),s={p:12};for(let i=0;i<count;i++){const type=rec[s.p++],key=bytes(rec,s).toString(),value=type===1?bytes(rec,s):Buffer.alloc(0);add(key,value,sequence+BigInt(i),type);}}}
const docs=[];for(const [key,row] of latest){if(row.type===0)continue;const text=row.value.toString();let value;try{value=JSON.parse(text);}catch{value={unparsed:text.slice(0,100)};}docs.push({key,...value});}return {files,docs};}

module.exports = { readPack };

