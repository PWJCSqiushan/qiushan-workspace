import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask,type Task} from '../lib/domain.ts';
import {emptyWorkspace,validateImport} from '../lib/workspace.ts';
import {applyTaskMutation,changedFields,editableKeys,mergeThreeWay,sha256,stable,type Mutation} from '../lib/protocol.ts';
import {setup} from './d1-helper.ts';
import type {Workspace} from '../lib/workspace.ts';

const stamp='2026-09-10T00:00:00.000Z';
function fixture(id:string,fields:Partial<Task>={}):Task{
 return {...newTask('projects'),id,title:id,createdAt:stamp,updatedAt:stamp,priority:'B',coordLetter:'C',...fields};
}
function mutation(task:Task,operation:Mutation['operation'],operationId=crypto.randomUUID()):Mutation{
 return {space:'personal',clientId:'compat-client',operationId,taskId:task.id,baseVersion:task.version,operation};
}
function source():Workspace{
 const project=fixture('compat-project',{kind:'project',projectId:'',priority:'A+',version:4});
 const child=fixture('compat-child',{kind:'task',projectId:project.id,priority:'B+',version:5});
 return {schemaVersion:1,space:'personal',revision:17,settings:{density:'comfortable'},tasks:[project,child]};
}

void test('legacy backup normalization keeps its stable hash and does not inject compatibility fields',async()=>{
 const legacy=fixture('legacy');
 delete legacy.kind;delete legacy.projectId;
 const workspace:Workspace={...emptyWorkspace('personal'),tasks:[legacy]};
 const validated=validateImport(workspace);
 assert.equal(Object.prototype.hasOwnProperty.call(validated.tasks[0],'kind'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(validated.tasks[0],'projectId'),false);
 assert.equal(stable(validated),stable(workspace));
 assert.equal(await sha256(validated),await sha256(workspace));
});

void test('new relation fields survive migration snapshot and are editable through old and new patches',async()=>{
 const {store}=await setup();
 const input=source();
 const preview=await store.preview('personal',input,'migration');
 assert.equal(preview.taskCount,2);
 await store.importWorkspace('personal',input,'compat-migration',preview.sourceHash,0,'migration');
 assert.deepEqual((await store.snapshot('personal')).workspace,input);
 const child=(await store.task('personal','compat-child'))!;
 assert.ok(editableKeys.includes('kind'));
 assert.ok(editableKeys.includes('projectId'));
 const oldPatch=(await store.mutate(mutation(child,{kind:'patch',patch:{title:'旧客户端改名'}}))).task!;
 assert.equal(oldPatch.kind,'task');
 assert.equal(oldPatch.projectId,'compat-project');
 const cleared=(await store.mutate(mutation(oldPatch,{kind:'patch',patch:{projectId:''}}))).task!;
 assert.equal(cleared.projectId,'');
 const reattached=(await store.mutate(mutation(cleared,{kind:'patch',patch:{projectId:'compat-project'}}))).task!;
 assert.equal(reattached.projectId,'compat-project');
});

void test('protocol patch and three-way merge preserve or surface relation changes',()=>{
 const project=fixture('p',{kind:'project'});
 const child=fixture('c',{kind:'task',projectId:project.id});
 const oldPatch=applyTaskMutation(child,mutation(child,{kind:'patch',patch:{title:'旧客户端标题'}}),new Date('2026-09-10T08:00:00+08:00'));
 assert.equal(oldPatch.kind,'task');
 assert.equal(oldPatch.projectId,project.id);
 const local={...child,projectId:''};
 const remote={...child,projectId:'another-project'};
 const merge=mergeThreeWay(child,local,remote);
 assert.deepEqual(merge.conflicts,['projectId']);
 assert.deepEqual(changedFields(child,local),{projectId:''});
});

void test('restore/import paths preserve optional fields and old workspaces remain readable',async()=>{
 const {store}=await setup();
 const input=source();
 await store.importWorkspace('personal',input,'compat-migration',await sha256(input),0,'migration');
 const restored=await setup();
 const p=await restored.store.preview('personal',input,'migration');
 await restored.store.importWorkspace('personal',input,'compat-recovery',p.sourceHash,0,'migration');
 const recovered=(await restored.store.snapshot('personal')).workspace;
 assert.deepEqual(recovered.tasks.map(t=>({id:t.id,kind:t.kind,projectId:t.projectId})),input.tasks.map(t=>({id:t.id,kind:t.kind,projectId:t.projectId})));
 const old=emptyWorkspace('personal');
 const oldTask=fixture('old-task');delete oldTask.kind;delete oldTask.projectId;old.tasks=[oldTask];
 const oldStore=await setup();
 const oldPreview=await oldStore.store.preview('personal',old,'migration');
 await oldStore.store.importWorkspace('personal',old,'old-recovery',oldPreview.sourceHash,0,'migration');
 const oldRecovered=(await oldStore.store.snapshot('personal')).workspace.tasks[0];
 assert.equal(Object.prototype.hasOwnProperty.call(oldRecovered,'kind'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(oldRecovered,'projectId'),false);
});

void test('store rejects project-to-task conversion with children and invalid parent links atomically',async()=>{
 const {store,sqlite}=await setup();
 const projectInput=fixture('stored-project',{kind:'project'});
 const project=(await store.mutate(mutation({...projectInput,version:0},{kind:'create',task:projectInput}))).task!;
 const childInput=fixture('stored-child',{kind:'task',projectId:project.id});
 await store.mutate(mutation({...childInput,version:0},{kind:'create',task:childInput}));
 const before=await store.task('personal',project.id);
 await assert.rejects(()=>store.mutate(mutation(project,{kind:'patch',patch:{kind:'task'}})),/已有子任务/);
 assert.deepEqual(await store.task('personal',project.id),before);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_receipts').get()!.n),2);

 const taskParentInput=fixture('stored-task-parent',{kind:'task'});
 const taskParent=(await store.mutate(mutation({...taskParentInput,version:0},{kind:'create',task:taskParentInput}))).task!;
 const badChild=fixture('bad-child',{kind:'task',projectId:taskParent.id});
 await assert.rejects(()=>store.mutate(mutation({...badChild,version:0},{kind:'create',task:badChild})),/只能指向项目/);
 assert.equal(await store.task('personal',badChild.id),null);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_receipts').get()!.n),3);
});

void test('relation race after preflight is stopped by the batch guard with no receipt, revision, or event',async()=>{
 const {store,sqlite}=await setup();
 const projectInput=fixture('race-project',{kind:'project',priority:'A'});
 const project=(await store.mutate(mutation({...projectInput,version:0},{kind:'create',task:projectInput},'race-project-create'))).task!;
 const before=await store.task('personal',project.id);
 const beforeRevision=Number(sqlite.prepare('SELECT revision FROM workspaces_v2 WHERE owner_id=? AND space=?').get('owner-a','personal')!.revision);
 const beforeReceipts=Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_receipts WHERE owner_id=? AND space=?').get('owner-a','personal')!.n);
 const beforeEvents=Number(sqlite.prepare('SELECT COUNT(*) n FROM change_log WHERE owner_id=? AND space=?').get('owner-a','personal')!.n);
 let injected=false;
 const original=store.relationError.bind(store);
 // This hook returns a clean preflight result, then injects the concurrent
 // child reference before Store.mutate calls its D1 batch.
 store.relationError=async(space,next)=>{
  const error=await original(space,next);
  if(!injected&&!error){
   injected=true;
   const childInput=fixture('race-child',{kind:'task',projectId:project.id,version:1});
   const payload={...childInput,completions:undefined};
   sqlite.prepare('INSERT INTO tasks(owner_id,space,task_id,version,flow,status,deleted_at,updated_at,payload,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner-a','personal',childInput.id,childInput.version,childInput.flow,childInput.status,childInput.deletedAt,childInput.updatedAt,JSON.stringify(payload),99);
  }
  return error;
 };
 await assert.rejects(()=>store.mutate(mutation(project,{kind:'patch',patch:{kind:'task'}},'race-project-task')),/已有子任务/);
 assert.equal(injected,true);
 assert.deepEqual(await store.task('personal',project.id),before);
 assert.equal(Number(sqlite.prepare('SELECT revision FROM workspaces_v2 WHERE owner_id=? AND space=?').get('owner-a','personal')!.revision),beforeRevision);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_receipts WHERE owner_id=? AND space=?').get('owner-a','personal')!.n),beforeReceipts);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM change_log WHERE owner_id=? AND space=?').get('owner-a','personal')!.n),beforeEvents);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM mutation_receipts WHERE owner_id=? AND space=? AND operation_id=?').get('owner-a','personal','race-project-task')!.n),0);
 assert.equal(Number(sqlite.prepare('SELECT COUNT(*) n FROM change_log WHERE owner_id=? AND space=? AND operation_id=?').get('owner-a','personal','race-project-task')!.n),0);
});
