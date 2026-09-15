import {FLOWS} from './domain.ts';

/** A workspace-local label that can be attached to a task in the same flow. */
export type Category = {
  id:string;
  flow:string;
  name:string;
  displayLabel:string;
  color:string;
  archived:boolean;
};

export type CategoryPatch = Partial<Pick<Category,'name'|'displayLabel'|'color'|'archived'>>;
export type CategoryPreset = Category;

export class CategoryValidationError extends Error {
  constructor(message:string){super(message);this.name='CategoryValidationError';}
}

const ID_RE=/^[a-zA-Z0-9_-]{1,100}$/;
const COLOR_RE=/^#[0-9a-fA-F]{6}$/;
const FLOW_IDS=new Set(FLOWS.map(flow=>flow.id));

function ensure(ok:unknown,message:string):asserts ok{
  if(!ok)throw new CategoryValidationError(message);
}

function textLength(value:string){return Array.from(value).length;}

export function validateCategory(value:unknown):Category{
  ensure(value&&typeof value==='object'&&!Array.isArray(value),'分类格式无效');
  const category=value as Partial<Category>;
  ensure(typeof category.id==='string'&&ID_RE.test(category.id),'分类 ID 无效');
  ensure(typeof category.flow==='string'&&FLOW_IDS.has(category.flow),'分类工作流无效');
  ensure(typeof category.name==='string','分类名称无效');
  ensure(typeof category.displayLabel==='string','分类简称无效');
  ensure(typeof category.color==='string'&&COLOR_RE.test(category.color),'分类颜色无效');
  ensure(typeof category.archived==='boolean','分类停用状态无效');
  const name=category.name.trim();
  let displayLabel=category.displayLabel.trim();
  ensure(name.length>0,'分类名称不能为空');
  ensure(textLength(name)<=20,'分类名称最多 20 字');
  if(!displayLabel&&textLength(name)<=3)displayLabel=name;
  ensure(displayLabel.length>0,'超过 3 字的分类必须填写卡面简称');
  ensure(textLength(displayLabel)<=3,'分类简称最多 3 字');
  return {id:category.id,flow:category.flow,name,displayLabel,color:category.color,archived:category.archived};
}

export function validateCategoryPatch(value:unknown):CategoryPatch{
  ensure(value&&typeof value==='object'&&!Array.isArray(value),'分类修改格式无效');
  const patch=value as Record<string,unknown>;
  const allowed=new Set(['name','displayLabel','color','archived']);
  ensure(Object.keys(patch).every(key=>allowed.has(key)),'分类不可修改工作流或 ID');
  if('name' in patch){ensure(typeof patch.name==='string','分类名称无效');const name=patch.name.trim();ensure(name.length>0&&textLength(name)<=20,'分类名称最多 20 字');}
  if('displayLabel' in patch){ensure(typeof patch.displayLabel==='string','分类简称无效');ensure(textLength(patch.displayLabel.trim())<=3,'分类简称最多 3 字');}
  if('color' in patch)ensure(typeof patch.color==='string'&&COLOR_RE.test(patch.color),'分类颜色无效');
  if('archived' in patch)ensure(typeof patch.archived==='boolean','分类停用状态无效');
  return {...patch,
    ...('name' in patch?{name:(patch.name as string).trim()}:{}),
    ...('displayLabel' in patch?{displayLabel:(patch.displayLabel as string).trim()}:{}),
  } as CategoryPatch;
}

/** Validate a full optional settings directory while preserving its order. */
export function validateCategories(value:unknown):Category[]|undefined{
  if(value===undefined)return undefined;
  ensure(Array.isArray(value)&&value.length<=200,'分类目录最多支持 200 项');
  const categories=value.map(validateCategory);
  const ids=new Set<string>();
  const names=new Set<string>();
  for(const category of categories){
    ensure(!ids.has(category.id),'分类目录中含有重复 ID');
    const nameKey=`${category.flow}\u0000${category.name}`;
    ensure(!names.has(nameKey),'同一工作流不能有同名分类');
    ids.add(category.id);names.add(nameKey);
  }
  return categories;
}

function preset(id:string,flow:string,name:string,color:string):Category{
  return {id,flow,name,displayLabel:name,color,archived:false};
}

const PRESETS:Record<string,readonly Category[]>={
  study:[
    preset('category-preset-study-1','study','考试','#ef4444'),
    preset('category-preset-study-2','study','作业','#facc15'),
  ],
  research:[
    preset('category-preset-research-1','research','竞赛','#a855f7'),
    preset('category-preset-research-2','research','科研','#14b8a6'),
    preset('category-preset-research-3','research','比赛','#f97316'),
  ],
  admin:[
    preset('category-preset-admin-1','admin','班级','#3b82f6'),
    preset('category-preset-admin-2','admin','秘书部','#8b5cf6'),
    preset('category-preset-admin-3','admin','志愿者','#22c55e'),
  ],
};

/**
 * Return deterministic preset records. This is intentionally a pure helper:
 * callers decide when to seed a directory, so production initialization never
 * silently adds categories.
 */
export function categoryPresets(flow?:string):Category[]{
  const source=flow===undefined?Object.values(PRESETS).flat():PRESETS[flow]||[];
  return source.map(category=>({...category}));
}

/** Add only missing presets; existing user edits always win. */
export function ensureCategoryPresets(existing:readonly Category[]|undefined,flow:string):Category[]{
  const result=[...(existing||[])].map(category=>({...category}));
  for(const category of categoryPresets(flow)){
    if(result.some(current=>current.id===category.id||current.flow===category.flow&&current.name===category.name))continue;
    result.push(category);
  }
  return result;
}

/** WCAG-style contrast choice for the solid badge background. */
export function categoryTextColor(color:string):'#111827'|'#ffffff'{
  ensure(typeof color==='string'&&COLOR_RE.test(color),'分类颜色无效');
  const rgb=[0,2,4].map(offset=>Number.parseInt(color.slice(offset+1,offset+3),16)/255);
  const linear=rgb.map(channel=>channel<=0.03928?channel/12.92:((channel+0.055)/1.055)**2.4);
  const luminance=0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
  const blackContrast=(luminance+0.05)/0.05;
  const whiteContrast=1.05/(luminance+0.05);
  return blackContrast>=whiteContrast?'#111827':'#ffffff';
}

export function categoryForFlow(categories:readonly Category[]|undefined,flow:string,includeArchived=false):Category[]{
  return (categories||[]).filter(category=>category.flow===flow&&(includeArchived||!category.archived)).map(category=>({...category}));
}

export function findCategory(categories:readonly Category[]|undefined,id:string|undefined):Category|undefined{
  if(!id)return undefined;
  const category=categories?.find(item=>item.id===id);
  return category?{...category}:undefined;
}

export function isCategoryId(value:unknown):value is string{return typeof value==='string'&&(value===''||ID_RE.test(value));}
