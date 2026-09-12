import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask,rowSort,globalSort,groupOf,GROUP_NAMES,type Task} from '../lib/domain.ts';
import {coordinateMutation,normalizeQueue} from '../lib/coordination.ts';

const day='2026-09-12';
const stamp='2026-09-12T00:00:00.000Z';

function task(id:string,fields:Partial<Task>={}):Task{
 return {...newTask('study'),id,title:id,createdAt:stamp,updatedAt:stamp,priority:'C',coordLetter:'',coordOrder:null,status:'准备推进',...fields};
}

function byId(tasks:Task[],id:string){const found=tasks.find(item=>item.id===id);assert.ok(found,`missing ${id}`);return found;}

function mutate(tasks:Task[],id:string,fields:Partial<Task>,kind='patch',operation:Record<string,unknown>={patch:{}}){
 const old=byId(tasks,id);
 const next={...old,...fields};
 return coordinateMutation(tasks,old,next,{kind,...operation},day);
}

test('normalizeQueue compresses positive positions by number, coordination grade, flow priority, then stable identity',()=>{
 const input=[
  task('late',{coordOrder:6,coordLetter:'A',priority:'S'}),
  task('first',{coordOrder:1,coordLetter:'B',priority:'A'}),
  task('tie-low',{coordOrder:3,coordLetter:'B',priority:'B'}),
  task('tie-high',{coordOrder:3,coordLetter:'A',priority:'B'}),
  task('zero',{coordOrder:0,coordLetter:'S'}),
  task('blank',{coordOrder:null,coordLetter:'S'}),
  task('ended',{coordOrder:2,status:'已结束'}),
  task('deleted',{coordOrder:5,deletedAt:'2026-09-11T01:00:00.000Z'}),
 ];
 const output=normalizeQueue(input);
 assert.deepEqual(input.map(item=>item.coordOrder),[6,1,3,3,0,null,2,5]);
 assert.equal(byId(output,'first').coordOrder,1);
 assert.equal(byId(output,'tie-high').coordOrder,2);
 assert.equal(byId(output,'tie-low').coordOrder,3);
 assert.equal(byId(output,'late').coordOrder,4);
 assert.equal(byId(output,'zero').coordOrder,0);
 assert.equal(byId(output,'blank').coordOrder,null);
 assert.equal(byId(output,'ended').coordOrder,null);
 assert.equal(byId(output,'ended').queueReturn?.complete,2);
 assert.equal(byId(output,'deleted').coordOrder,null);
 assert.equal(byId(output,'deleted').queueReturn?.deleted,5);
});

test('normalizeQueue keeps existing return markers and does not auto-number blank or zero cards',()=>{
 const ended=task('ended',{coordOrder:9,status:'已结束',queueReturn:{complete:4}});
 const deleted=task('deleted',{coordOrder:8,deletedAt:'2026-09-11T00:00:00.000Z',queueReturn:{deleted:3}});
 const blank=task('blank',{coordLetter:'A'});
 const zero=task('zero',{coordOrder:0});
 const output=normalizeQueue([ended,deleted,blank,zero]);
 assert.deepEqual(output.map(item=>item.coordOrder),[null,null,null,0]);
 assert.deepEqual(byId(output,'ended').queueReturn,{complete:9});
 assert.deepEqual(byId(output,'deleted').queueReturn,{deleted:8});
});

test('creating a numbered card inserts at the requested slot and clamps beyond the tail',()=>{
 const existing=[task('one',{coordOrder:1}),task('two',{coordOrder:2}),task('three',{coordOrder:3})];
 const inserted=task('inserted',{coordOrder:2});
 const afterInsert=coordinateMutation(existing,null,inserted,{kind:'create'},day);
 assert.deepEqual(afterInsert.map(item=>[item.id,item.coordOrder]),[['one',1],['two',3],['three',4],['inserted',2]]);
 const tail=task('tail',{coordOrder:99});
 const afterTail=coordinateMutation(afterInsert,null,tail,{kind:'create'},day);
 assert.equal(byId(afterTail,'tail').coordOrder,5);
 assert.deepEqual(existing.map(item=>item.coordOrder),[1,2,3]);
});

test('moving an existing number removes it first, then inserts it without gaps',()=>{
 const before=[task('one',{coordOrder:1}),task('two',{coordOrder:2}),task('three',{coordOrder:3}),task('four',{coordOrder:4})];
 const old=byId(before,'three');
 const after=coordinateMutation(before,old,{...old,coordOrder:1},{kind:'patch',patch:{coordOrder:1}},day);
 assert.deepEqual(after.map(item=>[item.id,item.coordOrder]),[['one',2],['two',3],['three',1],['four',4]]);
 const oldAgain=byId(after,'three');
 const tail=coordinateMutation(after,oldAgain,{...oldAgain,coordOrder:100},{kind:'patch',patch:{coordOrder:100}},day);
 assert.deepEqual(tail.map(item=>[item.id,item.coordOrder]),[['one',1],['two',2],['three',4],['four',3]]);
});

test('clearing a number or changing it to zero folds the queue and leaves zero untouched',()=>{
 const before=[task('one',{coordOrder:1}),task('two',{coordOrder:2}),task('three',{coordOrder:3}),task('zero',{coordOrder:0})];
 const cleared=mutate(before,'two',{coordOrder:null},'patch',{patch:{coordOrder:null}});
 assert.equal(byId(cleared,'two').coordOrder,null);
 assert.equal(byId(cleared,'three').coordOrder,2);
 assert.equal(byId(cleared,'zero').coordOrder,0);
 const toZero=mutate(cleared,'one',{coordOrder:0},'patch',{patch:{coordOrder:0}});
 assert.equal(byId(toZero,'one').coordOrder,0);
 assert.equal(byId(toZero,'three').coordOrder,1);
 assert.equal(byId(toZero,'zero').coordOrder,0);
});

test('manual assignment from zero or blank inserts into the shared positive queue',()=>{
 const before=[task('one',{coordOrder:1}),task('zero',{coordOrder:0}),task('blank',{coordOrder:null})];
 const zeroToTwo=mutate(before,'zero',{coordOrder:2},'patch',{patch:{coordOrder:2}});
 assert.equal(byId(zeroToTwo,'zero').coordOrder,2);
 assert.equal(byId(zeroToTwo,'one').coordOrder,1);
 const blank=byId(zeroToTwo,'blank');
 const blankToOne=coordinateMutation(zeroToTwo,blank,{...blank,coordOrder:1},{kind:'patch',patch:{coordOrder:1}},day);
 assert.equal(byId(blankToOne,'blank').coordOrder,1);
 assert.equal(byId(blankToOne,'one').coordOrder,2);
 assert.equal(byId(blankToOne,'zero').coordOrder,3);
});

test('ordinary completion releases a number, records its position, and repeated completion does not shift twice',()=>{
 const before=[task('one',{coordOrder:1}),task('done',{coordOrder:2}),task('three',{coordOrder:3})];
 const old=byId(before,'done');
 const ended={...old,status:'已结束'};
 const completed=coordinateMutation(before,old,ended,{kind:'complete'},day);
 assert.equal(byId(completed,'done').coordOrder,null);
 assert.equal(byId(completed,'done').queueReturn?.complete,2);
 assert.equal(byId(completed,'three').coordOrder,2);
 const latest=byId(completed,'done');
 const repeated=coordinateMutation(completed,latest,{...latest,status:'已结束'},{kind:'complete'},day);
 assert.deepEqual(repeated.map(item=>item.coordOrder),[1,null,2]);
 assert.equal(byId(repeated,'done').queueReturn?.complete,2);
});

test('reopening a completed card reinserts its saved position and clears only that marker',()=>{
 const before=[task('one',{coordOrder:1}),task('done',{coordOrder:null,status:'已结束',queueReturn:{complete:2}}),task('three',{coordOrder:2})];
 const old=byId(before,'done');
 const reopened=coordinateMutation(before,old,{...old,status:'准备推进'},{kind:'reopen'},day);
 assert.equal(byId(reopened,'done').coordOrder,2);
 assert.equal(byId(reopened,'done').queueReturn,undefined);
 assert.equal(byId(reopened,'three').coordOrder,3);
});

test('patching status to ended follows completion rules and patching back restores the saved slot',()=>{
 const before=[task('one',{coordOrder:1}),task('done',{coordOrder:2}),task('three',{coordOrder:3})];
 const ended=mutate(before,'done',{status:'已结束'},'patch',{patch:{status:'已结束'}});
 assert.equal(byId(ended,'done').queueReturn?.complete,2);
 assert.equal(byId(ended,'three').coordOrder,2);
 const reopened=mutate(ended,'done',{status:'正在推进'},'patch',{patch:{status:'正在推进'}});
 assert.equal(byId(reopened,'done').coordOrder,2);
 assert.equal(byId(reopened,'three').coordOrder,3);
});

test('daily completion releases once, same-day undo restores it, and a later day never auto-numbers it',()=>{
 const before=[task('one',{coordOrder:1}),task('routine',{coordOrder:2,daily:true}),task('three',{coordOrder:3})];
 const old=byId(before,'routine');
 const checked=coordinateMutation(before,old,{...old,completions:[day]},{kind:'setCompleted',value:true,date:day},day);
 assert.equal(byId(checked,'routine').coordOrder,null);
 assert.equal(byId(checked,'routine').queueReturn?.complete,2);
 assert.equal(byId(checked,'three').coordOrder,2);
 const undone=coordinateMutation(checked,byId(checked,'routine'),{...byId(checked,'routine'),completions:[]},{kind:'setCompleted',value:false,date:day},day);
 assert.equal(byId(undone,'routine').coordOrder,2);
 assert.equal(byId(undone,'routine').queueReturn,undefined);
 const nextDay='2026-09-13';
 const nextCheck=coordinateMutation(undone,byId(undone,'routine'),{...byId(undone,'routine'),completions:[nextDay]},{kind:'setCompleted',value:true,date:nextDay},nextDay);
 assert.equal(byId(nextCheck,'routine').coordOrder,null);
 assert.equal(byId(nextCheck,'three').coordOrder,2);
});

test('completing a zero-number card never changes positive positions',()=>{
 const before=[task('one',{coordOrder:1}),task('zero',{coordOrder:0}),task('three',{coordOrder:2})];
 const old=byId(before,'zero');
 const after=coordinateMutation(before,old,{...old,status:'已结束'},{kind:'complete'},day);
 assert.equal(byId(after,'zero').coordOrder,0);
 assert.equal(byId(after,'one').coordOrder,1);
 assert.equal(byId(after,'three').coordOrder,2);
});

test('deleting and restoring a card uses its deleted return position, while zero remains zero',()=>{
 const before=[task('one',{coordOrder:1}),task('deleted',{coordOrder:2}),task('three',{coordOrder:3}),task('zero',{coordOrder:0})];
 const old=byId(before,'deleted');
 const deleted=coordinateMutation(before,old,{...old,deletedAt:'2026-09-12T02:00:00.000Z'},{kind:'setDeleted',value:true},day);
 assert.equal(byId(deleted,'deleted').coordOrder,null);
 assert.equal(byId(deleted,'deleted').queueReturn?.deleted,2);
 assert.equal(byId(deleted,'three').coordOrder,2);
 const restored=coordinateMutation(deleted,byId(deleted,'deleted'),{...byId(deleted,'deleted'),deletedAt:null},{kind:'setDeleted',value:false},day);
 assert.equal(byId(restored,'deleted').coordOrder,2);
 assert.equal(byId(restored,'three').coordOrder,3);
 const zeroOld=byId(restored,'zero');
 const zeroDeleted=coordinateMutation(restored,zeroOld,{...zeroOld,deletedAt:'2026-09-12T02:00:00.000Z'},{kind:'delete'},day);
 const zeroRestored=coordinateMutation(zeroDeleted,byId(zeroDeleted,'zero'),{...byId(zeroDeleted,'zero'),deletedAt:null},{kind:'restore'},day);
 assert.equal(byId(zeroRestored,'zero').coordOrder,0);
 assert.equal(byId(zeroRestored,'one').coordOrder,1);
});

test('row and global sorting use coordination number, coordination letter, then flow priority',()=>{
 const zero=task('zero',{coordOrder:0,coordLetter:'NA',priority:'NA'});
 const oneA=task('one-a',{coordOrder:1,coordLetter:'B',priority:'S'});
 const oneB=task('one-b',{coordOrder:1,coordLetter:'A',priority:'C'});
 const oneC=task('one-c',{coordOrder:1,coordLetter:'A',priority:'A'});
 const blankS=task('blank-s',{coordOrder:null,coordLetter:'S',priority:'C'});
 const blankNA=task('blank-na',{coordOrder:null,coordLetter:'NA',priority:'S'});
 assert.ok(rowSort(zero,oneA)<0);
 assert.ok(rowSort(oneB,oneA)<0);
 assert.ok(rowSort(oneC,oneB)<0);
 assert.ok(rowSort(oneA,blankS)<0);
 assert.ok(rowSort(blankS,blankNA)<0);
});

test('global sorting has exactly emergency, today boost, and ordinary groups; daily cards stay ordinary',()=>{
 const emergency=task('emergency',{emergency:true,coordOrder:null});
 const boosted=task('boosted',{boostDate:day,coordOrder:99});
 const daily=task('daily',{daily:true,coordOrder:1});
 const ordinary=task('ordinary',{coordOrder:2});
 assert.deepEqual(GROUP_NAMES,['紧急事项','本次先做','普通事项']);
 assert.equal(groupOf(emergency,day),0);
 assert.equal(groupOf(boosted,day),1);
 assert.equal(groupOf(daily,day),2);
 assert.equal(groupOf(ordinary,day),2);
 assert.ok(globalSort(emergency,boosted,day)<0);
 assert.ok(globalSort(boosted,daily,day)<0);
 assert.ok(globalSort(daily,ordinary,day)<0);
 assert.ok(globalSort(boosted,task('expired',{boostDate:'2026-09-11',coordOrder:null}),day)<0);
});

test('coordinateMutation is pure and retains unrelated task fields',()=>{
 const before=[task('one',{coordOrder:1,notes:'keep',checklist:[{id:'a',text:'x',done:false}]}),task('two',{coordOrder:2})];
 const old=byId(before,'one');
 const after=coordinateMutation(before,old,{...old,coordOrder:2},{kind:'patch',patch:{coordOrder:2}},day);
 assert.equal(after,after);
 assert.notEqual(after, before);
 assert.notEqual(after[0].checklist,before[0].checklist);
 assert.equal(byId(after,'one').notes,'keep');
 assert.deepEqual(before.map(item=>[item.id,item.coordOrder]),[['one',1],['two',2]]);
});
