import test from 'node:test';
import assert from 'node:assert/strict';
import {newTask,gradeRank} from '../lib/domain.ts';
import {validateTask,validateTaskRelations} from '../lib/workspace.ts';
import {buildFlowLayout} from '../lib/project-layout.ts';
import {mapCoordLetter,mapFlowPriority,mapPriorityMapping,previewPriorityMapping} from '../lib/priority-mapping.ts';
import type {Task} from '../lib/domain.ts';

const baseDate='2026-09-10T00:00:00.000Z';
function task(id:string,fields:Partial<Task>={}):Task{
 return {...newTask('projects'),id,title:id,createdAt:baseDate,updatedAt:baseDate,priority:'C',coordLetter:'',...fields};
}

void test('newTask keeps compatibility fields absent and the new unset label ranks distinctly',()=>{
 const t=newTask();
 assert.equal(Object.prototype.hasOwnProperty.call(t,'kind'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(t,'projectId'),false);
 assert.ok(gradeRank('D')<gradeRank('未定'),'未定 sorts after D');
 assert.ok(gradeRank('未定')<gradeRank('NA'),'未定 remains distinct from NA');
});

void test('approved flow mapping covers every listed historical level and reports anomalies',()=>{
 const expected:Record<string,string>={
  'S+':'S',S:'S','S-':'S','A+':'A+','A':'A','A-':'A',
  'B+':'B',B:'B','B-':'B','C+':'C',C:'C','C-':'C',
  'D+':'D',D:'D','D-':'D','E+':'D',E:'D','E-':'D',Z:'D',
  NA:'NA','未定':'','':'',
 };
 for(const [source,target] of Object.entries(expected)){
  const out=mapFlowPriority(source);
  assert.equal(out.ok,true,source);
  assert.equal(out.value,target||source,source);
 }
 assert.equal(mapFlowPriority('EM').ok,false);
 assert.equal(mapFlowPriority('A++').ok,false);
 assert.equal(mapFlowPriority('EM').issue?.field,'priority');
});

void test('coordination mapping preserves approved values, maps F-Z, and does not guess anomalies',()=>{
 for(const value of ['', 'S','A','B','C','D','E','NA','未定']){
  const out=mapCoordLetter(value);assert.equal(out.ok,true,value);assert.equal(out.value,value);
 }
 assert.equal(mapCoordLetter('F').value,'E');
 assert.equal(mapCoordLetter('Z').value,'E');
 assert.equal(mapCoordLetter('S+').ok,false);
 assert.equal(mapCoordLetter('AA').ok,false);
 const pair=mapPriorityMapping('B+','Z');
 assert.deepEqual(pair,{priority:'B',coordLetter:'E',changed:true,issues:[],ok:true});
 const rows=previewPriorityMapping([task('preview',{version:4,priority:'A-',coordLetter:'F'})]);
 assert.deepEqual(rows[0],{id:'preview',title:'preview',version:4,priorityBefore:'A-',priorityAfter:'A',coordLetterBefore:'F',coordLetterAfter:'E',changed:true,ok:true,issues:[]});
});

void test('one-level project layout groups same-flow children, retains cross-flow references, and orders by anchor',()=>{
 const project=task('project',{kind:'project',priority:'C',title:'大项目'});
 const childHigh=task('child-high',{kind:'task',projectId:'project',priority:'S'});
 const childLow=task('child-low',{kind:'task',projectId:'project',priority:'B'});
 const cross=task('cross',{flow:'study',kind:'task',projectId:'project',priority:'A+'});
 const ended=task('ended',{kind:'task',projectId:'project',priority:'A',status:'已结束'});
 const routineDone=task('routine-done',{kind:'task',projectId:'project',priority:'A',daily:true,completions:['2026-09-10']});
 const independent=task('independent',{priority:'A'});
 const all=[project,childLow,childHigh,cross,ended,routineDone,independent];
 const units=buildFlowLayout(all,[project,childLow,childHigh,independent], 'projects',new Date('2026-09-10T08:00:00+08:00'));
 assert.equal(units.length,2);
 assert.equal(units[0].kind,'group');
 if(units[0].kind!=='group')return;
 assert.equal(units[0].project.id,'project');
 assert.deepEqual(units[0].children.map(x=>x.id),['child-high','child-low']);
 assert.deepEqual(units[0].completedChildren.map(x=>x.id),['ended','routine-done']);
 assert.deepEqual(units[0].completedTodayChildren.map(x=>x.id),['routine-done']);
 assert.deepEqual(units[0].endedChildren.map(x=>x.id),['ended']);
 assert.deepEqual(units[0].crossFlowChildren.map(x=>x.id),['cross']);
 assert.equal(units[0].anchor.id,'child-high');
 assert.equal(units[1].kind,'independent');
});

void test('daily today-complete items keep a visible unit and are split from unfinished children',()=>{
 const project=task('daily-project',{kind:'project',daily:true,completions:['2026-09-10'],priority:'B'});
 const child=task('daily-child',{kind:'task',projectId:'daily-project',daily:true,completions:['2026-09-10'],priority:'A'});
 const independent=task('daily-independent',{daily:true,completions:['2026-09-10'],priority:'S'});
 const now=new Date('2026-09-10T08:00:00+08:00');
 const units=buildFlowLayout([project,child,independent],[project,child,independent],'projects',now);
 assert.equal(units.length,2);
 const group=units.find(x=>x.kind==='group');
 assert.ok(group&&group.kind==='group');
 if(group&&group.kind==='group'){
  assert.deepEqual(group.completedTodayChildren.map(x=>x.id),['daily-child']);
  assert.deepEqual(group.children,[]);
 }
 const solo=units.find(x=>x.kind==='independent');
 assert.ok(solo&&solo.kind==='independent');
 if(solo&&solo.kind==='independent')assert.equal(solo.task.id,'daily-independent');
 const childContext=buildFlowLayout([project,child],[child],'projects',now);
 assert.equal(childContext.length,1);
 assert.equal(childContext[0].kind,'group');
 if(childContext[0].kind==='group'){assert.equal(childContext[0].contextOnly,true);assert.equal(childContext[0].completedTodayChildren[0].id,'daily-child');}
});

void test('filtering a child keeps project context without counting it as a task, and unavailable parents free children',()=>{
 const project=task('project',{kind:'project',priority:'C',title:'项目上下文'});
 const child=task('child',{kind:'task',projectId:'project',priority:'A',title:'命中子任务'});
 const contextOnly=buildFlowLayout([project,child],[child],'projects',new Date('2026-09-10T08:00:00+08:00'));
 assert.equal(contextOnly.length,1);
 assert.equal(contextOnly[0].kind,'group');
 if(contextOnly[0].kind==='group'){
  assert.equal(contextOnly[0].contextOnly,true);
  assert.deepEqual(contextOnly[0].children.map(x=>x.id),['child']);
 }
 for(const changed of [
  {...project,status:'已结束'},
  {...project,deletedAt:'2026-09-10T01:00:00.000Z'},
  {...project,flow:'study'},
 ]){
  const units=buildFlowLayout([changed,child],[child],'projects',new Date('2026-09-10T08:00:00+08:00'));
  assert.equal(units.length,1);
  assert.equal(units[0].kind,'independent');
  if(units[0].kind==='independent')assert.equal(units[0].project?.id,'project');
 }
});

void test('relationship validation allows an orphan link but rejects self, parent-on-project, and nested known task links',()=>{
 const project=task('p',{kind:'project'});
 const child=task('c',{kind:'task',projectId:'p'});
 assert.doesNotThrow(()=>validateTaskRelations([project,child]));
 assert.doesNotThrow(()=>validateTask({...child,projectId:'missing'}));
 assert.throws(()=>validateTask({...project,projectId:'other'}),/项目不能关联父项目/);
 assert.throws(()=>validateTask({...child,projectId:'c'}),/不能关联自己/);
 assert.throws(()=>validateTaskRelations([task('parent',{kind:'task'}),task('child',{kind:'task',projectId:'parent'})]),/只能指向项目/);
});
