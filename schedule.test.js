import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,diffDays,validDate,buildTimeline,getDueTopics,nextRevision,parseIntervals,monthShift} from '../schedule.js';
const sample = () => ({id:'a',subject:'Medicine',topic:'SLE',startDate:'2026-11-23',intervals:[1,3,8,15],cycleDays:21,history:[],adjustments:[]});
test('calendar math across leap years and DST independent',()=>{
 assert.equal(addDays('2028-02-28',1),'2028-02-29');
 assert.equal(addDays('2028-02-29',1),'2028-03-01');
 assert.equal(diffDays('2026-12-01','2026-11-23'),8);
 assert.equal(validDate('2027-02-29'),false);
 assert.equal(monthShift('2027-01-31',1),'2027-02-01');
});
test('1 3 8 15 then 21-day loops',()=>{
 const t=sample(); const rev=buildTimeline(t,'2027-03-01').slice(0,7);
 assert.deepEqual(rev.map(r=>r.due),['2026-11-24','2026-11-26','2026-12-01','2026-12-08','2026-12-29','2027-01-19','2027-02-09']);
});
test('late completion fixed keeps original schedule',()=>{
 const t=sample();t.history.push({index:0,dueDate:'2026-11-24',completedOn:'2026-11-28',mode:'fixed'});
 assert.equal(nextRevision(t,null,'2026-11-29').due,'2026-11-26');
});
test('late completion shift moves all later days',()=>{
 const t=sample();t.history.push({index:0,dueDate:'2026-11-24',completedOn:'2026-11-28',mode:'shift'});
 assert.deepEqual(buildTimeline(t,'2026-12-20').slice(0,4).map(r=>r.due),['2026-11-24','2026-11-30','2026-12-05','2026-12-12']);
});
test('manual individual adjustment retains gap',()=>{
 const t=sample();t.adjustments=[{fromIndex:0,days:4}];
 assert.equal(nextRevision(t,null,'2026-11-23').due,'2026-11-28');
});
test('overdue separate from today, future and paused',()=>{
 const old=sample(), now=sample(), paused=sample();old.id='old';old.startDate='2026-11-20';now.id='now';paused.id='paused';paused.paused=true;
 const x=getDueTopics([old,now,paused],'2026-11-24');
 assert.equal(x.overdue.length,1);assert.equal(x.due.length,1);assert.equal(x.upcoming.length,0);
});
test('cutoff suppresses later revisions',()=>{
 const t=sample();
 t.history=[{index:0,completedOn:'2026-11-24',mode:'fixed'},{index:1,completedOn:'2026-11-26',mode:'fixed'}];
 assert.equal(nextRevision(t,'2026-11-28','2026-11-27'),null);
});
test('validates custom intervals',()=>{
 assert.deepEqual(parseIntervals('1,3,8,15'),[1,3,8,15]);
 for(const v of ['1,1,8','0,3','3,1','-1,7','1,xyz','1,,5'])assert.throws(()=>parseIntervals(v));
});
