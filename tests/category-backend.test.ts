import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask} from '../lib/domain.ts';
import {categoryPresets,categoryTextColor,validateCategory,validateCategoryPatch} from '../lib/categories.ts';
import {Store} from '../lib/storage-v2.ts';
import {ConflictError} from '../lib/protocol.ts';
import {enableCoordination} from '../lib/coordinated-store.ts';
import {sha256} from '../lib/protocol.ts';
import {database} from './d1-helper.ts';
import {backupAll} from '../lib/backup.ts';

const category={id:'cat-study',flow:'study',name:'考试',displayLabel:'考试',color:'#ef4444',archived:false};

function mutation(operation:unknown,extra:Record<string,unknown>={}){
 return {space:'personal' as const,clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:0,operation,...extra};
}

void test('category helpers validate stable records, allow empty patches, and choose readable text',()=>{
 assert.deepEqual(validateCategory(category),category);
 assert.deepEqual(validateCategoryPatch({}),{});
 assert.equal(categoryTextColor('#ffffff'),'#111827');
 assert.equal(categoryTextColor('#111111'),'#ffffff');
 assert.equal(categoryPresets('study').length,2);
 assert.equal(categoryPresets('projects').length,0);
 assert.throws(()=>validateCategory({...category,name:'这是一段明确超过二十字限制的分类名称示例文本'}));
 assert.throws(()=>validateCategory({...category,flow:'missing'}));
});

void test('ready coordination keeps category CAS independent from task and queue versions',async()=>{
 const {db,sqlite}=database();
 const store=new Store(db,'owner-category');
 await store.initialize('synthetic');
 await store.mutate(mutation({kind:'categoryCreate',category}));
 await enableCoordination(store,'personal',1);
 const beforeTask=await store.snapshot('personal');
 const task={...newTask('study'),id:'cat-task',title:'分类事项',categoryId:category.id,coordOrder:1};
 await store.mutate({...mutation({kind:'create',task}, {taskId:task.id,protocolVersion:3,queueVersion:beforeTask.workspace.queueVersion,capturedAt:new Date().toISOString()})});
 const before=await store.snapshot('personal');
 const eventCount=Number(sqlite.prepare('SELECT COUNT(*) n FROM task_events').get()!.n);
 const updated=await store.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:before.settingsVersion,operation:{kind:'categoryUpdate',categoryId:category.id,patch:{name:'期末考',color:'#001122'}}});
 assert.equal(updated.settingsVersion,before.settingsVersion+1);
 const after=await store.snapshot('personal');
 assert.deepEqual(after.workspace.tasks,before.workspace.tasks);
 assert.equal(after.workspace.queueVersion,before.workspace.queueVersion);
 assert.equal(after.workspace.settings.categories?.[0].name,'期末考');
 const comfortable=await store.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:after.settingsVersion,operation:{kind:'settings',density:'comfortable'}});
 assert.equal(comfortable.settings?.categories?.[0].name,'期末考');
 const afterDensity=await store.snapshot('personal');
 assert.equal(afterDensity.workspace.settings.density,'comfortable');
 assert.deepEqual(afterDensity.workspace.tasks,before.workspace.tasks);
 assert.equal(afterDensity.workspace.queueVersion,before.workspace.queueVersion);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM task_events').get()!.n,eventCount);
});

void test('empty category update is idempotent and archived categories reject new references',async()=>{
 const {db}=database();
 const store=new Store(db,'owner-archived');
 await store.initialize('synthetic');
 await store.mutate(mutation({kind:'categoryCreate',category}));
 const current=await store.snapshot('personal');
 await store.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:current.settingsVersion,operation:{kind:'categoryUpdate',categoryId:category.id,patch:{}}});
 const wrongFlow={...newTask('research'),id:'wrong-flow',title:'严格流归属',categoryId:category.id};
 await assert.rejects(()=>store.mutate(mutation({kind:'create',task:wrongFlow},{taskId:wrongFlow.id})),e=>e instanceof ConflictError&&e.code==='CATEGORY_CONFLICT');
 const archivedState=await store.snapshot('personal');
 await store.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:archivedState.settingsVersion,operation:{kind:'categoryUpdate',categoryId:category.id,patch:{archived:true}}});
 const next={...newTask('study'),id:'new-archived',title:'不应新关联',categoryId:category.id};
 await assert.rejects(()=>store.mutate(mutation({kind:'create',task:next},{taskId:next.id})),e=>e instanceof ConflictError&&e.code==='CATEGORY_CONFLICT');
});

void test('restore retains a tombstone category missing from the incoming directory',async()=>{
 const {db}=database();
 const store=new Store(db,'owner-restore');
 await store.initialize('synthetic');
 await store.mutate(mutation({kind:'categoryCreate',category}));
 const task={...newTask('study'),id:'restore-task',title:'保留历史引用',categoryId:category.id};
 await store.mutate({...mutation({kind:'create',task},{taskId:task.id})});
 const current=await store.snapshot('personal');
 await store.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),taskId:task.id,baseVersion:current.workspace.tasks[0].version,operation:{kind:'setDeleted',value:true}});
 const deleted=await store.snapshot('personal');
 const conflicting={...deleted.workspace,settings:{density:deleted.workspace.settings.density,categories:[{...category,id:'other-cat'}]},tasks:[]};
 await assert.rejects(()=>store.preview('personal',conflicting,'restore'),/同流重名/);
 const source={...deleted.workspace,tasks:[],settings:{density:deleted.workspace.settings.density,categories:[]},history:undefined};
 const preview=await store.preview('personal',source,'restore');
 assert.equal(preview.categoryNotice,undefined);
 await store.importWorkspace('personal',source,'restore-missing-category',await sha256(source),deleted.workspace.revision,'restore');
 const restored=await store.snapshot('personal');
 const retained=restored.workspace.tasks.find(item=>item.id===task.id)!;
 assert.equal(retained.deletedAt!==null,true);
 assert.equal(retained.categoryId,category.id);
 assert.equal(restored.workspace.settings.categories?.find(item=>item.id===category.id)?.archived,true);
});

void test('restore accepts an archived category reference supplied by a complete backup',async()=>{
 const sourceDb=database();
 const source=new Store(sourceDb.db,'owner-archived-source');
 await source.initialize('synthetic');
 await source.mutate(mutation({kind:'categoryCreate',category}));
 const task={...newTask('study'),id:'archived-backup-task',title:'停用分类历史事项',categoryId:category.id};
 await source.mutate({...mutation({kind:'create',task},{taskId:task.id})});
 const sourceState=await source.snapshot('personal');
 await source.mutate({space:'personal',clientId:'category-test',operationId:crypto.randomUUID(),baseVersion:sourceState.settingsVersion,operation:{kind:'categoryUpdate',categoryId:category.id,patch:{archived:true}}});
 const backup=await source.exportWorkspace('personal');
 assert.equal(backup.settings.categories?.[0].archived,true);

 const targetDb=database();
 const target=new Store(targetDb.db,'owner-archived-target');
 await target.initialize('synthetic');
 const preview=await target.preview('personal',backup,'restore');
 await target.importWorkspace('personal',backup,'restore-archived-complete',await sha256(backup),preview.expectedRevision,'restore');
 const restored=await target.snapshot('personal');
 assert.equal(restored.workspace.tasks[0].categoryId,category.id);
 assert.equal(restored.workspace.settings.categories?.[0].archived,true);
});

void test('backup envelope retains categories and coordination history',async()=>{
 const {db}=database();
 const store=new Store(db,'owner-backup-category');
 await store.initialize('synthetic');
 await store.mutate(mutation({kind:'categoryCreate',category}));
 await enableCoordination(store,'personal',1);
 const task={...newTask('study'),id:'backup-task',title:'备份引用',categoryId:category.id};
 const before=await store.snapshot('personal');
 await store.mutate({...mutation({kind:'create',task},{taskId:task.id,protocolVersion:3,queueVersion:before.workspace.queueVersion,capturedAt:new Date().toISOString()})});
 const values=new Map<string,string>();
 await backupAll(db,{put:async(key:string,value:string)=>{values.set(key,value);}} as unknown as KVNamespace);
 const personal=[...values.entries()].find(([key])=>key.includes('/personal/'))?.[1];
 assert.ok(personal);
 const envelope=JSON.parse(personal!);
 assert.equal(envelope.workspace.settings.categories[0].id,category.id);
 assert.equal(Array.isArray(envelope.workspace.history.events),true);
});
