import assert from 'node:assert/strict';
import test from 'node:test';
import {newTask} from '../lib/domain.ts';
import {cardKind,cardTone,coordinationParts,duePresentation,isCompleted,taskTimestamp} from '../lib/card-presentation.ts';

function task(overrides: Partial<ReturnType<typeof newTask>> = {}) {
  return {...newTask('study'),...overrides};
}

void test('card tone follows approved priority and identity precedence without changing color',()=>{
  const now = new Date('2026-09-11T04:00:00Z');
  assert.equal(cardTone(task({priority:'S',color:'#123456'}),now),'high');
  assert.equal(cardTone(task({coordLetter:'S'}),now),'high');
  assert.equal(cardTone(task({priority:'S',emergency:true}),now),'emergency');
  assert.equal(cardTone(task({priority:'S',daily:true}),now),'daily');
  assert.equal(cardTone(task({priority:'S',status:'已结束'}),now),'completed');
});

void test('date-only due uses Beijing end of day and exposes today/remaining state',()=>{
  const due = task({due:'2026-09-11'});
  const before = new Date('2026-09-11T12:00:00Z');
  const presentation = duePresentation(due,before);
  assert.equal(taskTimestamp('2026-09-11'),Date.parse('2026-09-11T15:59:59Z'));
  assert.equal(presentation?.state,'today');
  assert.match(presentation?.detail ?? '',/^剩余 /);
  const after = duePresentation(due,new Date('2026-09-11T16:00:00Z'));
  assert.equal(after?.state,'overdue');
});

void test('coordination order keeps numeric zero and NA separate',()=>{
  assert.deepEqual(coordinationParts('A',0),{label:'A0',letter:'A',order:'0'});
  assert.deepEqual(coordinationParts('NA',0),{label:'NA',letter:'NA',order:''});
  assert.deepEqual(coordinationParts('',null),{label:'未定',letter:'未定',order:''});
});

void test('kind falls back to legacy unclassified and daily completion follows shared clock',()=>{
  const now = new Date('2026-09-11T04:00:00Z');
  const routine = task({daily:true,completions:['2026-09-11']});
  assert.equal(cardKind(routine),'unclassified');
  assert.equal(isCompleted(routine,now),true);
  assert.equal(cardKind({...routine,kind:'project'}),'project');
});
