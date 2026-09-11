import type {Task} from './domain.ts';

export type MappingField='priority'|'coordLetter';
export type MappingIssue={
 field:MappingField;
 value:string;
 code:'UNKNOWN_LEVEL';
 message:string;
};

export type MappingOutcome={
 ok:boolean;
 value:string;
 changed:boolean;
 issue?:MappingIssue;
};

export type PriorityMapping={
 priority:string;
 coordLetter:string;
 changed:boolean;
 issues:MappingIssue[];
 ok:boolean;
};

/** Map the historical flow priority into the approved eight-value selector.
 * Empty and 未定 are both preserved because the former is a legacy unset value
 * and the latter is an explicit value. Unknown strings are reported verbatim.
 */
export function mapFlowPriority(value:string):MappingOutcome{
 if(value===''||value==='未定'||value==='NA')return {ok:true,value,changed:false};
 const match=/^([A-Z])([+-])?$/.exec(value);
 if(!match)return {ok:false,value,changed:false,issue:{field:'priority',value,code:'UNKNOWN_LEVEL',message:'本流等级未列入批准映射，需人工审查'}};
 const letter=match[1];
 let mapped:string;
 if(letter==='S')mapped='S';
 else if(letter==='A')mapped=match[2]==='+'?'A+':'A';
 else if(letter==='B')mapped='B';
 else if(letter==='C')mapped='C';
 else mapped='D';
 return {ok:true,value:mapped,changed:mapped!==value};
}

/** Map the historical coordination letter. The coordination number is kept
 * outside this function and is therefore never changed by a mapping. */
export function mapCoordLetter(value:string):MappingOutcome{
 if(value===''||value==='S'||value==='A'||value==='B'||value==='C'||value==='D'||value==='E'||value==='NA'||value==='未定')return {ok:true,value,changed:false};
 if(/^[F-Z]$/.test(value))return {ok:true,value:'E',changed:true};
 return {ok:false,value,changed:false,issue:{field:'coordLetter',value,code:'UNKNOWN_LEVEL',message:'协调等级未列入批准映射，需人工审查'}};
}

export function mapPriorityMapping(priority:string,coordLetter:string):PriorityMapping{
 const mappedPriority=mapFlowPriority(priority),mappedCoord=mapCoordLetter(coordLetter);
 const issues=[...(mappedPriority.issue?[mappedPriority.issue]:[]),...(mappedCoord.issue?[mappedCoord.issue]:[])];
 return {priority:mappedPriority.value,coordLetter:mappedCoord.value,changed:mappedPriority.changed||mappedCoord.changed,issues,ok:issues.length===0};
}

export function mapTaskPriorities(task:Pick<Task,'priority'|'coordLetter'>):PriorityMapping{
 return mapPriorityMapping(task.priority,task.coordLetter);
}

export type PriorityMappingPreview={
 id:string;
 title:string;
 version:number;
 priorityBefore:string;
 priorityAfter:string;
 coordLetterBefore:string;
 coordLetterAfter:string;
 changed:boolean;
 ok:boolean;
 issues:MappingIssue[];
};

/** Produce a read-only per-card preview. An issue blocks only that card; this
 * function never substitutes a guessed value for an unknown level. */
export function previewPriorityMapping(tasks:readonly Pick<Task,'id'|'title'|'version'|'priority'|'coordLetter'>[]):PriorityMappingPreview[]{
 return tasks.map(task=>{
  const mapped=mapTaskPriorities(task);
  return {id:task.id,title:task.title,version:task.version,priorityBefore:task.priority,priorityAfter:mapped.priority,coordLetterBefore:task.coordLetter,coordLetterAfter:mapped.coordLetter,changed:mapped.changed,ok:mapped.ok,issues:mapped.issues};
 });
}

