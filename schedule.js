/* Pure calendar-date scheduling. All dates are local YYYY-MM-DD strings. */
export const DEFAULT_INTERVALS = [1, 3, 8, 15];
export const DEFAULT_CYCLE = 21;

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function addDays(key, days) {
  if (!validDate(key) || !Number.isInteger(days)) throw new Error('Invalid calendar calculation');
  const [y,m,d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m-1, d + days));
  return date.toISOString().slice(0,10);
}
export function diffDays(later, earlier) {
  if (!validDate(later) || !validDate(earlier)) throw new Error('Invalid calendar comparison');
  return Math.round((Date.parse(later+'T00:00:00Z') - Date.parse(earlier+'T00:00:00Z')) / 86400000);
}
export function parseIntervals(raw) {
  const parts = String(raw).split(',').map(x=>x.trim());
  if (!parts.length || parts.some(x=>!/^\d+$/.test(x))) throw new Error('Enter positive whole-day intervals separated by commas.');
  const nums = parts.map(Number);
  if (nums.length > 20 || nums.some((x,i)=>!Number.isSafeInteger(x)||x<1||x>3650||(i && x<=nums[i-1]))) {
    throw new Error('Intervals must be unique, increasing whole days between 1 and 3650.');
  }
  return nums;
}
function stageOffset(index, intervals, cycle) {
  return index < intervals.length ? intervals[index] : intervals[intervals.length-1]+(index-intervals.length+1)*cycle;
}
/** Returns all scheduled occurrences through endDate, including completed records if present. */
export function buildTimeline(topic, endDate, maxStages=600) {
  const intervals = topic.intervals || DEFAULT_INTERVALS;
  const cycle = topic.cycleDays || DEFAULT_CYCLE;
  if (!validDate(topic.startDate) || !validDate(endDate) || !intervals.length) return [];
  const history = Array.isArray(topic.history) ? topic.history : [];
  const adjustments = Array.isArray(topic.adjustments) ? topic.adjustments : [];
  const done = new Map(history.map(h=>[h.index,h]));
  let shift = 0;
  const result=[];
  for(let i=0;i<maxStages;i++) {
    for (const a of adjustments) if(a.fromIndex===i) shift += a.days;
    const due = addDays(topic.startDate,stageOffset(i,intervals,cycle)+shift);
    const record=done.get(i) || null;
    if(due>endDate && !record) break;
    result.push({index:i,number:i+1,due,record,completed:!!record});
    if(record && record.mode==='shift') {
      shift+=Math.max(0,diffDays(record.completedOn, due));
    }
  }
  return result;
}
export function nextRevision(topic, cutoff = null, now = todayKey()) {
  const end=cutoff || addDays(now, 3650);
  const index=Array.isArray(topic.history) ? topic.history.length : 0;
  const found=buildTimeline(topic, end, Math.max(index+2,600)).find(t=>t.index===index);
  return found || null;
}
export function getDueTopics(topics, now=todayKey(), cutoff=null) {
  const due=[],overdue=[],upcoming=[],finished=[];
  for (const topic of topics.filter(t=>!t._deleted)) {
    if (topic.paused) continue;
    const next=nextRevision(topic,cutoff,now);
    if(!next) {finished.push({topic});continue;}
    const item={topic,...next,lateDays:Math.max(0,diffDays(now,next.due))};
    if (next.due<now) overdue.push(item);
    else if (next.due===now) due.push(item);
    else upcoming.push(item);
  }
  const cmp=(a,b)=>a.due.localeCompare(b.due)||a.topic.topic.localeCompare(b.topic.topic);
  due.sort(cmp);overdue.sort(cmp);upcoming.sort(cmp);
  return {due,overdue,upcoming,finished};
}
export function periodDates(key,period){
  if(period==='week'){
    const [y,m,d]=key.split('-').map(Number);const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
    const start=addDays(key,-((weekday+6)%7));return [start,addDays(start,6)];
  }
  if(period==='month')return [key.slice(0,7)+'-01',addDays(addDays(key.slice(0,7)+'-01',32).slice(0,7)+'-01',-1)];
  return [key,key];
}
export function monthShift(key, delta) {
  const [y,m]=key.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1+delta,1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`;
}
