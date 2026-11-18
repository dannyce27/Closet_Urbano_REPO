import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function localDB(file){
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(new URL('../migrations/0001_shop.sql',import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...a)=>prepare(sql,a),run:()=>db.prepare(sql).run(...args),first:()=>db.prepare(sql).get(...args),all:()=>({results:db.prepare(sql).all(...args)})}}
 return {prepare,batch:async stmts=>{db.exec('BEGIN IMMEDIATE');try{const out=stmts.map(s=>s.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}
}
