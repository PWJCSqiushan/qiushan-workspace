export const FLOWS = [
  { id: 'study', name: '主线工作流', detail: '课程 / 学习 / 考试', color: '#8faaff', mark:'01' },
  { id: 'research', name: '杠杆工作流Ⅰ', detail: '竞赛 / 科研', color: '#bc9bf5', mark:'02' },
  { id: 'projects', name: '杠杆工作流Ⅱ', detail: '开发 / 项目交付', color: '#7fbbef', mark:'03' },
  { id: 'admin', name: '行政社交流', detail: '班长 / 学生会', color: '#eab484', mark:'04' },
  { id: 'team', name: '企划社交流Ⅰ', detail: '活动团队', color: '#87c8a0', mark:'05' },
  { id: 'creator', name: '企划社交流Ⅱ', detail: '个人公开账号', color: '#dfa1b9', mark:'06' },
  { id: 'furry', name: '企划社交流Ⅲ', detail: '兴趣', color: '#c4afea', mark:'07' },
  { id: 'running', name: '备赛流', detail: '路跑赛事 / 日常训练', color: '#b9ce7d', mark:'08' },
  { id: 'other', name: '其他', detail: '生活中的其余事项', color: '#9caabf', mark:'09' },
];
export const STATUSES = ['准备推进','正在推进','等待外部','一般关注','暂停','已结束'];
export const COLORS = ['#8faaff','#bc9bf5','#7fbbef','#eab484','#87c8a0','#dfa1b9','#b9ce7d','#9caabf'];
export type TaskKind = 'project'|'task';
export type Task = {
 id:string; version:number; flow:string; title:string; project:string; start:string; end:string; due:string;
 location:string; notes:string; minutes:number|null; checklist:{id:string;text:string;done:boolean}[];
 priority:string; coordLetter:string; coordOrder:number|null; emergency:boolean; flagged:boolean; daily:boolean;
 color:string; status:string; stage:string; boostDate:string; boostAt:string; boostReason:string;
 completions:string[]; createdAt:string; updatedAt:string; deletedAt:string|null;
 /** Optional compatibility fields. They are deliberately absent from newTask(). */
 kind?:TaskKind; projectId?:string;
};
export function today(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function newTask(flow='study'):Task { const stamp=new Date().toISOString(); return {id:crypto.randomUUID(), version:0, flow,title:'',project:'',start:'',end:'',due:'',location:'',notes:'',minutes:null,checklist:[],priority:'',coordLetter:'',coordOrder:null,emergency:false,flagged:false,daily:false,color:FLOWS.find(f=>f.id===flow)?.color||COLORS[0],status:'准备推进',stage:'',boostDate:'',boostAt:'',boostReason:'',completions:[],createdAt:stamp,updatedAt:stamp,deletedAt:null}; }
export const GRADES=['S',...'ABCDEFGHIJKLMNOPQRTUVWXYZ'];
export function gradeRank(s:string) { if(s==='NA') return 1000; if(!s||s==='未定')return 999; const i=GRADES.indexOf(s[0]); return i<0?998:i*3+(s.endsWith('+')?0:s.endsWith('-')?2:1); }
export function doneToday(t:Task,date=today()){return t.daily&&t.completions.includes(date);}
export function rowSort(a:Task,b:Task){return gradeRank(a.priority)-gradeRank(b.priority)||(a.coordOrder??Infinity)-(b.coordOrder??Infinity)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);}
export function groupOf(t:Task,date=today()) { return t.emergency?0:t.boostDate===date?1:t.coordLetter==='NA'?5:t.coordOrder!==null?2:t.daily?3:4; }
export const GROUP_NAMES=['紧急事项','本次先做','执行次序','每日例行','待排次序','NA · 暂不安排'];
export function globalSort(a:Task,b:Task,date=today()){const g=groupOf(a,date)-groupOf(b,date); if(g)return g; if(groupOf(a,date)===1)return a.boostAt.localeCompare(b.boostAt)||a.id.localeCompare(b.id); return (a.coordOrder??Infinity)-(b.coordOrder??Infinity)||gradeRank(a.coordLetter)-gradeRank(b.coordLetter)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);}
export function stampMs(v:string){return v?Date.parse(v.length===10?v+'T23:59:59+08:00':v+'+08:00'):NaN;}
export function deadline(t:Task,now=new Date()){const n=stampMs(t.due);if(!Number.isFinite(n)||t.status==='已结束'||doneToday(t,today(now)))return '';return n<+now?'已逾期':n-+now<86400000?'即将截止':'';}
export function matches(t:Task,filter:string,now=new Date()) { const d=today(now);if(filter==='flag')return t.flagged;if(filter==='overdue')return deadline(t,now)==='已逾期';if(filter==='today')return (t.daily&&t.status!=='暂停')||t.start.slice(0,10)===d||t.due.slice(0,10)===d;if(filter==='week')return [t.start,t.due].some(v=>stampMs(v)>=+now&&stampMs(v)<+now+7*86400000);return true; }
export function coordCode(t:Task){return t.coordLetter==='NA'?'NA':t.coordLetter||t.coordOrder!==null?`${t.coordLetter||'·'}${t.coordOrder??''}`:'未定';}
export function displayTime(t:Task){ const v=t.start||t.due; if(!v)return t.daily?'每日例行':'时间待定';return v.slice(5).replace('T',' ') + (!t.start?' 截止':''); }
export function demoTasks():Task[] { const date=today(); const specs=[
 ['study','核心课程 · 整理本周知识点','S','A',6,'图书馆','每日学习','正在推进'],
 ['study','微积分 · 练习与错题回顾','A','B',1,'自习室','课程基础','准备推进'],
 ['research','竞赛组会 · 对齐下一步分工','A','A',3,'线上会议','竞赛项目组','准备推进'],
 ['research','科研项目 · 整理实验记录','B+','B',5,'','阶段材料','正在推进'],
 ['projects','项目交付 · 核对验收清单','A','A',2,'','软件项目','正在推进'],
 ['projects','等待项目组反馈','B','C',8,'','外部协作','等待外部'],
 ['admin','班级材料 · 最后核对与提交','B','B',4,'','班长事务','准备推进'],
 ['team','活动团队 · 本周活动企划','B','B',7,'','跑队运营','正在推进'],
 ['creator','视频选题 · 留住一个校园片段','C','D',10,'','个人账号','一般关注'],
 ['furry','社群活动 · 整理出行备忘','C','NA',null,'','兴趣社群','一般关注'],
 ['running','轻松跑 · 按自己的节奏','A','C',9,'校园操场','日常训练','准备推进'],
 ['other','生活补给 · 列一张采购清单','C','',null,'','生活事务','准备推进']
 ];return specs.map((s,i)=>({...newTask(s[0] as string),id:'demo-'+i,title:s[1] as string,priority:s[2] as string,coordLetter:s[3] as string,coordOrder:s[4] as number|null,location:s[5] as string,project:s[6] as string,status:s[7] as string,notes:'这是一张演示卡片，用于体验工作台，不代表已确认的当前待办。',daily:i===0,flagged:i===0||i===4,emergency:i===6,start:i===2?date+'T20:00':i===10?date+'T18:00':'',due:i===6?date+'T23:00':'',minutes:[60,45,30,60,90,null,15,30,30,null,45,15][i],version:1})); }
