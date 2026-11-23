import {DEFAULT_INTERVALS,DEFAULT_CYCLE,todayKey,validDate,addDays,diffDays,parseIntervals,buildTimeline,nextRevision,getDueTopics,periodDates,monthShift} from './schedule.js';
import {createCloud} from './cloud.js';

const SUBJECTS=['Anatomy','Physiology','Biochemistry','Pathology','Pharmacology','Microbiology','ENT','Ophthalmology','PSM','FMT','Medicine','Surgery','OBG','Pediatrics','Dermatology','Anaesthesia','Radiology','Psychiatry','Orthopaedics'];
const STORAGE='master-recall-v2-state';
const TITLES={dashboard:'Overview',add:'Add topics',subjects:'Subject library',calendar:'Revision calendar',study:'Study & MCQ log',analytics:'Analytics',settings:'Settings & backup'};
const $=id=>document.getElementById(id);
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const id=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fmtDate=key=>{if(!validDate(key))return key||'—';const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});};
const fmtShort=key=>{const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'short'});};
const fmtHour=x=>Number(x||0).toFixed(1).replace(/\.0$/,'');
const sum=(arr,fn)=>arr.reduce((x,item)=>x+fn(item),0);
const minmax=(x,min,max)=>Math.max(min,Math.min(max,x));
const activeTopics=()=>state.topics.filter(t=>!t._deleted);
const activeLogs=()=>state.logs.filter(x=>!x._deleted);
const isFuture=(key)=>key>todayKey();
const theme=()=>document.documentElement.dataset.theme||'light';
const localDefault=()=>({version:2,userScope:null,topics:[],logs:[],settings:{id:'main',examDate:'',defaultIntervals:[...DEFAULT_INTERVALS],defaultCycle:DEFAULT_CYCLE,revisionLimit:15,dailyReminder:true,theme:'light',fontSize:16,_updatedAt:Date.now()}});
function loadLocal(){
  try {const raw=localStorage.getItem(STORAGE);if(!raw)return localDefault();const parsed=JSON.parse(raw);if(parsed?.version!==2||!Array.isArray(parsed.topics)||!Array.isArray(parsed.logs)||!parsed.settings)throw Error('Unrecognized state');return parsed;}
  catch(error){bootIssue=`Could not safely load saved data: ${error.message}. No existing data was overwritten.`;return localDefault();}
}
let bootIssue='';
let state=loadLocal();
let currentView='dashboard',addMode='today',calendarMonth=todayKey().slice(0,7)+'-01',selectedCalendarDay=todayKey();
let cloud=null,cloudStatus='unconfigured',cloudStatusDetail='',cloudUser=null,cloudBusy=false,saveError=false,toastTimer=null;
let editingSessionId=null;
function bump(entity){entity._updatedAt=Math.max(Date.now(),(entity._updatedAt||0)+1);return entity;}
function persist(){try{const serialized=JSON.stringify(state);localStorage.setItem(STORAGE,serialized);if(state.userScope)localStorage.setItem(`${STORAGE}-account-${state.userScope}`,serialized);saveError=false;return true;}catch(e){saveError=true;toast('Browser storage failed. Changes were NOT saved: '+e.message,true);return false;}}
function transaction(fn,writes=[]){
  const previous=clone(state);try{fn();if(!persist()){state=previous;renderAll();return false;}}
  catch(e){state=previous;toast(e.message,true);return false;}
  renderAll();
  if(cloudUser&&cloud){for(const [kind,item] of writes)cloud.write(kind,clone(item)).catch(e=>{cloudStatus='error';cloudStatusDetail=e.message;renderCloud();toast('Cloud sync error: '+e.message,true);});}
  return true;
}
function toast(message,error=false){const el=$('toast');el.textContent=message;el.style.background=error?'#872d38':'#1c3b32';el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4200);}
function alertBanner(message,action=null){const el=$('announcement');if(!message){el.classList.add('hidden');return;}el.classList.remove('hidden');el.innerHTML=h(message)+(action?` <button type="button" id="bannerAction">${h(action.label)}</button>`:'');if(action)$('bannerAction').onclick=action.fn;}
function statCard(label,value,foot='',color=''){return `<div class="stat-card ${color}"><div class="stat-label">${h(label)}</div><div class="stat-number">${h(value)}</div><div class="stat-foot">${h(foot)}</div></div>`;}
function noItems(message,icon='✦'){return `<div class="empty"><span class="empty-icon">${icon}</span>${h(message)}</div>`;}
function subjectSelectOptions(defaultLabel='Select subject'){return `<option value="">${h(defaultLabel)}</option>`+SUBJECTS.map(s=>`<option value="${h(s)}">${h(s)}</option>`).join('');}
function setupSelects(){
  for(const name of ['topicSubject','studySubject'])$(name).innerHTML=subjectSelectOptions(name==='topicSubject'?'Select one of 19 subjects':'General / mixed study');
  for(const name of ['librarySubject','historySubject'])$(name).innerHTML=`<option value="all">All subjects</option>`+SUBJECTS.map(s=>`<option value="${h(s)}">${h(s)}</option>`).join('');
}
function currentBuckets(){return getDueTopics(activeTopics(),todayKey(),state.settings.examDate||null);}
function applyDisplayPrefs(){document.documentElement.dataset.theme=state.settings.theme||'light';document.documentElement.style.setProperty('--font-base',`${minmax(Number(state.settings.fontSize)||16,13,22)}px`);}
function syncFormSettings(){
  $('examDate').value=state.settings.examDate||'';
  $('settingsIntervals').value=(state.settings.defaultIntervals||DEFAULT_INTERVALS).join(',');
  $('settingsCycle').value=state.settings.defaultCycle||21;
  $('revisionLimit').value=state.settings.revisionLimit||15;
  $('dailyReminder').checked=state.settings.dailyReminder!==false;
  $('topicIntervals').value=(state.settings.defaultIntervals||DEFAULT_INTERVALS).join(',');
  $('topicCycle').value=state.settings.defaultCycle||21;
}
function setView(view){
  if(!TITLES[view])return;
  currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.nav-link[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('pageTitle').textContent=TITLES[view];
  $('sidebar').classList.remove('open');
  if(view==='add')updateAddPreview();
  if(view==='settings')syncFormSettings();
  renderCurrent();window.scrollTo?.({top:0,behavior:'smooth'});
}
function renderCurrent(){
  if(currentView==='dashboard')renderDashboard();
  if(currentView==='subjects')renderLibrary();
  if(currentView==='calendar')renderCalendar();
  if(currentView==='study')renderStudy();
  if(currentView==='analytics')renderAnalytics();
  if(currentView==='settings')renderSettings();
}
function renderAll(){renderHeader();renderCurrent();}
function renderHeader(){
  $('headerDate').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  if(!cloudUser){$('sideMode').textContent='Offline-first · Local mode';}
  renderCloud();
}
function renderCloud(){
 const labels={unconfigured:'Local only',connecting:'Connecting',synced:'Cloud synced',syncing:'Syncing…',offline:'Offline',error:'Sync error','cache-limited':'Limited offline','signed-out':'Sign in to sync'};
 $('cloudLabel').textContent=labels[cloudStatus]||'Local only';
 $('cloudDot').className='status-dot '+(cloudStatus==='synced'?'synced':cloudStatus==='error'?'error':'');
 $('sideMode').textContent=cloudUser?`Cloud · ${cloudUser.name}`:'Offline-first · Local mode';
 if($('cloudDetails'))$('cloudDetails').innerHTML=cloudUser?`<strong>${h(cloudUser.name)}</strong><p>${h(labels[cloudStatus]||cloudStatus)}. ${h(cloudStatusDetail)}</p>`:`<strong>${cloudStatus==='unconfigured'?'Local mode':'Cloud available'}</strong><p>${cloudStatus==='unconfigured'?'Add your Firebase configuration to enable cross-device sync.':h(cloudStatusDetail||'Sign in to synchronize your revisions.')}</p>`;
 if($('signInBtn')){
  $('signInBtn').textContent=cloudUser?'Connected':'Connect with Google';
  $('signInBtn').disabled=!!cloudUser||cloudBusy;
  $('signOutBtn').classList.toggle('hidden',!cloudUser);
 }
}
function prepareNewDate(){const now=todayKey();$('topicStartDate').value=now;$('topicStartDate').max=now;$('studyDate').value=now;$('studyDate').max=now;}
function updateAddPreview(){
 try {const intervals=parseIntervals($('topicIntervals').value);const cycle=Number($('topicCycle').value);if(!Number.isInteger(cycle)||cycle<1||cycle>3650)throw Error('Invalid repeat interval');
 const start=addMode==='past'?$('topicStartDate').value:todayKey();if(!validDate(start))return;
 const candidates=[...intervals,...Array.from({length:4},(_,i)=>intervals.at(-1)+(i+1)*cycle)].map(n=>addDays(start,n)).filter(d=>d>=todayKey()&&(!state.settings.examDate||d<=state.settings.examDate));
 const end=candidates.at(-1),counts=new Map(candidates.map(d=>[d,0]));
 if(end)for(const topic of activeTopics().filter(t=>!t.paused))for(const r of buildTimeline(topic,end)){if(!r.completed&&counts.has(r.due))counts.set(r.due,counts.get(r.due)+1);}
 const limit=state.settings.revisionLimit||15,busy=candidates.find(d=>(counts.get(d)||0)+1>limit);
 $('schedulePreview').textContent=`R1 ${fmtShort(addDays(start,intervals[0]))} · R${intervals.length+1} ${fmtShort(addDays(start,intervals.at(-1)+cycle))}`+(busy?` · ⚠ ${fmtShort(busy)} may exceed your ${limit}-revision daily limit`:'' );
 }catch{$('schedulePreview').textContent='Enter valid revision intervals to preview dates.';}
}
function setAddMode(mode){addMode=mode;$('pastDateBox').classList.toggle('hidden',mode!=='past');$('addTodayTab').classList.toggle('selected',mode==='today');$('addPastTab').classList.toggle('selected',mode==='past');updateAddPreview();}
function createTopic(e){
 e.preventDefault();
 const subject=$('topicSubject').value,topic=$('topicName').value.trim().replace(/\s+/g,' '),startDate=addMode==='past'?$('topicStartDate').value:todayKey();
 if(!SUBJECTS.includes(subject)||!topic||topic.length>160||!validDate(startDate)||startDate>todayKey()){toast('Choose a subject, valid topic, and a study date no later than today.',true);return;}
 let intervals,cycle;try{intervals=parseIntervals($('topicIntervals').value);cycle=Number($('topicCycle').value);if(!Number.isInteger(cycle)||cycle<1||cycle>3650)throw Error('Repeat interval must be 1–3650 days.');}catch(e){toast(e.message,true);return;}
 const duplicate=activeTopics().find(t=>t.subject===subject&&t.topic.toLocaleLowerCase()===topic.toLocaleLowerCase()&&t.startDate===startDate);
 if(duplicate&&!confirm('A topic with the same subject, name and starting date already exists. Add another?'))return;
 const item={id:id(),subject,topic,startDate,difficulty:$('topicDifficulty').value,defaultLateMode:$('topicLateDefault').value,notes:$('topicNotes').value.trim(),intervals,cycleDays:cycle,history:[],adjustments:[],paused:false,_deleted:false,_updatedAt:Date.now()};
 if(transaction(()=>state.topics.push(item),[['topics',item]])){
  $('topicName').value='';$('topicNotes').value='';$('topicSubject').value='';toast(`${topic} added. First revision: ${fmtDate(addDays(startDate,intervals[0]))}`);
 }
}
function completedThisDay(day){return activeTopics().flatMap(t=>(t.history||[]).filter(x=>x.completedOn===day));}
function daysDebt(buckets){return sum(buckets.overdue,t=>t.lateDays);}
function renderDashboard(){
 const now=todayKey(),b=currentBuckets(),todayLogs=activeLogs().filter(x=>x.date===now);
 const hours=sum(todayLogs,x=>x.hours),mcqs=sum(todayLogs,x=>x.mcqs),finishedToday=completedThisDay(now).length;
 const hourAll=sum(activeLogs(),x=>x.hours);
 $('heroGreeting').textContent=new Date().getHours()<12?'Start strong. Recall better.':new Date().getHours()<18?'Stay sharp. Keep building.':'Finish well. Keep the gains.';
 $('heroText').textContent=(b.overdue.length?`${b.overdue.length} overdue topic${b.overdue.length>1?'s':''} need attention. Handle them individually, no bulk postponing.`:'A clear schedule is a useful thing. Keep the repetition consistent.')+(state.settings.examDate?` · Exam ${diffDays(state.settings.examDate,now)>=0?'in '+diffDays(state.settings.examDate,now)+' days':'date passed'}.`:'');
 $('overviewStats').innerHTML=statCard('Due today',b.due.length,`${finishedToday} revisions completed today`,'green')+statCard('Overdue',b.overdue.length,`${daysDebt(b)} combined days late`,'red')+statCard('MCQs today',mcqs,`${todayLogs.length} study session${todayLogs.length===1?'':'s'}`)+statCard('Hours studied',fmtHour(hours)+'h',`${fmtHour(hourAll)}h logged all time`);
 $('dueCount').textContent=b.due.length;$('overdueCount').textContent=b.overdue.length;
 $('dueList').innerHTML=b.due.length?b.due.map(x=>revisionCard(x)).join(''):noItems('Nothing due today. Use the time to tackle a challenging topic.','✓');
 $('overdueList').innerHTML=b.overdue.length?b.overdue.map(x=>revisionCard(x)).join(''):noItems('No overdue revisions. Your schedule is clear.','✓');
 const in7=activeTopics().filter(t=>!t.paused).flatMap(topic=>buildTimeline(topic,addDays(now,7)).filter(rev=>rev.due>now&&!rev.completed).map(rev=>({topic,...rev}))).sort((a,b)=>a.due.localeCompare(b.due)||a.topic.topic.localeCompare(b.topic.topic));
 $('upcomingList').innerHTML=in7.length?in7.slice(0,9).map(x=>`<div class="upcoming-row"><div><strong>${h(x.topic.topic)}</strong><div class="task-sub">${h(x.topic.subject)} · R${x.number}</div></div><div class="upcoming-date">${h(fmtShort(x.due))}</div></div>`).join(''):noItems('No revisions scheduled within the next 7 days.');
 const [ws,we]=periodDates(now,'week'),weekly=activeLogs().filter(x=>x.date>=ws&&x.date<=we);
 $('studyPulse').innerHTML=`<div class="pulse-stats"><div class="pulse-card"><strong>${h(fmtHour(sum(weekly,x=>x.hours)))}h</strong><span>Study hours this week</span></div><div class="pulse-card"><strong>${h(sum(weekly,x=>x.mcqs))}</strong><span>MCQs this week</span></div></div><div class="progress-line"><div class="progress-fill" style="width:${Math.min(100,(finishedToday/Math.max(1,finishedToday+b.due.length+b.overdue.length))*100)}%"></div></div><p class="field-hint" style="margin-top:9px">Today's revision completion share (including outstanding overdue topics): ${finishedToday} done, ${b.due.length+b.overdue.length} pending</p>`;
 if(state.settings.dailyReminder&&b.due.length+b.overdue.length>0){alertBanner(`${b.due.length} revisions due today · ${b.overdue.length} overdue.`,{label:'Review now',fn:()=>document.querySelector('#dueList .small-btn, #overdueList .small-btn')?.click()});}else alertBanner('');
}
function revisionCard(x){return `<div class="task-card ${x.lateDays?'late':''}"><div class="task-top"><span class="topic-tag ${x.lateDays?'late':''}">${h(x.topic.subject)}</span><span class="topic-tag ${x.lateDays?'late':''}">R${x.number}${x.lateDays?' · '+x.lateDays+'d late':''}</span></div><div class="task-title" style="margin-top:9px">${h(x.topic.topic)}</div><div class="task-sub">Due ${h(fmtDate(x.due))} · ${h(x.topic.difficulty||'Moderate')} recall</div><div class="task-actions"><button class="small-btn" data-action="review" data-id="${h(x.topic.id)}">✓ Mark revised</button><button class="small-btn outline" data-action="postpone" data-id="${h(x.topic.id)}">Reschedule this topic</button><button class="small-btn outline" data-action="edit" data-id="${h(x.topic.id)}">Details</button></div></div>`;}
function openModal(title,subtitle,body,buttons=''){
 const host=$('modalHost');host.innerHTML=`<div class="modal-window" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-head"><div><h2>${h(title)}</h2>${subtitle?`<p>${h(subtitle)}</p>`:''}</div><button class="close-btn" data-close aria-label="Close">✕</button></div>${body}${buttons}</div>`;
 host.classList.remove('hidden');host.querySelector('[data-close]').onclick=closeModal;
 host.onclick=e=>{if(e.target===host)closeModal();};
}
function closeModal(){$('modalHost').classList.add('hidden');$('modalHost').innerHTML='';}
function modalButtons(saveText='Save',buttonId='modalConfirm'){return `<div class="modal-actions"><button class="outline-btn" data-close-modal>Cancel</button><button class="primary-btn" id="${h(buttonId)}">${h(saveText)}</button></div>`;}
function wireModalCancel(){$('modalHost').querySelectorAll('[data-close-modal]').forEach(el=>el.onclick=closeModal);}
function topicById(id){return state.topics.find(t=>t.id===id&&!t._deleted);}
function getTopicNext(t){return nextRevision(t,state.settings.examDate||null,todayKey());}
function reviewTopic(topicId){
 const t=topicById(topicId);if(!t)return;
 const next=getTopicNext(t);if(!next){toast('This topic has no further revisions before the exam cutoff.');return;}
 const late=diffDays(todayKey(),next.due),canShift=late>0;
 openModal(`Mark R${next.number} revised`,`${t.subject} · ${t.topic}`,`<div class="tip" style="margin-bottom:18px">Scheduled ${h(fmtDate(next.due))}${late>0?` · <strong>${late} days late</strong>`:''}. Completion date: <strong>${h(fmtDate(todayKey()))}</strong>.</div><label class="field"><span>How well did you recall it?</span><select id="qualitySelect"><option value="Good">Good · mostly remembered</option><option value="Partial">Partial · some gaps</option><option value="Poor">Poor · needs work</option></select></label><div class="section-kicker" style="margin:17px 0 12px">FUTURE REVISION DATES</div><label class="mode-choice"><input type="radio" name="lateMode" value="fixed" ${!canShift||t.defaultLateMode!=='shift'?'checked':''}><span><strong>Keep the fixed schedule</strong><small>Do not move the next planned revision even if it is now overdue.</small></span></label><label class="mode-choice"><input type="radio" name="lateMode" value="shift" ${canShift&&t.defaultLateMode==='shift'?'checked':''} ${!canShift?'disabled':''}><span><strong>Shift future revisions by ${Math.max(0,late)} day${late===1?'':'s'}</strong><small>Only this topic moves. Completed historical dates remain unchanged.</small></span></label>${!canShift?'<p class="field-hint">Shifting is available when the revision is completed late.</p>':''}`+modalButtons('Confirm revision','confirmReview'));
 wireModalCancel();
 $('confirmReview').onclick=()=>{
  const quality=$('qualitySelect').value,mode=document.querySelector('input[name="lateMode"]:checked')?.value||'fixed';
  const event={index:next.index,dueDate:next.due,completedOn:todayKey(),quality,mode:canShift?mode:'fixed',id:id()};
  const updated=clone(t);updated.history.push(event);bump(updated);
  if(transaction(()=>{const idx=state.topics.findIndex(x=>x.id===updated.id);state.topics[idx]=updated;},[['topics',updated]])){
   closeModal();toast(`${t.topic} · R${next.number} completed. ${mode==='shift'?'Future dates shifted.':'Fixed dates retained.'}`);
   const undoId=event.id;
   offerUndo(updated.id,undoId);
  }
 };
}
let undoTimer=null;
function offerUndo(topicId,eventId){
 // Avoid irreversible accidental taps: show an explicit undo action until the next navigation.
 const el=$('announcement');el.classList.remove('hidden');el.innerHTML=`Revision saved. <button id="undoRevision" type="button">Undo completion</button> <button id="dismissUndo" type="button">Dismiss</button>`;
 $('undoRevision').onclick=()=>{
  const t=topicById(topicId);if(!t)return;
  if(t.history.at(-1)?.id!==eventId){toast('Can only undo the latest revision of this topic.',true);return;}
  const updated=clone(t);updated.history.pop();bump(updated);
  transaction(()=>{state.topics[state.topics.findIndex(x=>x.id===topicId)]=updated;},[['topics',updated]]);
  alertBanner('');toast('Last revision undone.');
 };
 $('dismissUndo').onclick=()=>alertBanner('');
 clearTimeout(undoTimer);undoTimer=setTimeout(()=>{if($('undoRevision'))alertBanner('');},20000);
}
function postponeTopic(topicId){
 const t=topicById(topicId);if(!t)return;const next=getTopicNext(t);if(!next)return;
 openModal('Reschedule one topic',`${t.subject} · ${t.topic}`,`<div class="tip" style="margin-bottom:16px">Only <strong>${h(t.topic)}</strong> will move. Its original due date was ${h(fmtDate(next.due))}. This does <strong>not</strong> count as a completed revision.</div><label class="field"><span>New due date</span><input type="date" id="postponeDate" min="${h(todayKey())}" value="${h(todayKey())}"></label><p class="field-hint">All future repetitions for this topic shift by the same difference. The adjustment is saved in its history.</p>`+modalButtons('Reschedule topic','confirmPostpone'));
 wireModalCancel();
 $('confirmPostpone').onclick=()=>{
  const date=$('postponeDate').value;if(!validDate(date)||date<todayKey()){toast('Choose today or a future date.',true);return;}
  const delta=diffDays(date,next.due);if(delta===0){closeModal();return;}
  const updated=clone(t);updated.adjustments.push({id:id(),fromIndex:next.index,days:delta,createdOn:todayKey(),originalDue:next.due,newDue:date});bump(updated);
  if(transaction(()=>{state.topics[state.topics.findIndex(x=>x.id===t.id)]=updated;},[['topics',updated]])){closeModal();toast(`Only ${t.topic} rescheduled to ${fmtDate(date)}.`);}
 };
}
function editTopic(topicId){
 const t=topicById(topicId);if(!t)return;
 const next=getTopicNext(t);
 const timeline=buildTimeline(t,state.settings.examDate||addDays(todayKey(),180));
 const history=t.history.map(ev=>`<div class="history-detail">R${ev.index+1} · due ${h(fmtDate(ev.dueDate||t.startDate))} · completed ${h(fmtDate(ev.completedOn))} · ${h(ev.quality||'Unrated')} · ${ev.mode==='shift'?'shifted':'fixed'}</div>`).join('');
 const body=`<div class="form-grid"><label class="field"><span>Subject</span><select id="editSubject">${SUBJECTS.map(s=>`<option ${s===t.subject?'selected':''}>${h(s)}</option>`).join('')}</select></label><label class="field"><span>Topic name</span><input id="editName" maxlength="160" value="${h(t.topic)}"></label></div><div class="form-grid"><label class="field"><span>Study date</span><input id="editStart" type="date" value="${h(t.startDate)}" max="${h(todayKey())}" ${t.history.length?'disabled':''}></label><label class="field"><span>Difficulty</span><select id="editDifficulty">${['Easy','Moderate','Hard'].map(s=>`<option ${s===t.difficulty?'selected':''}>${s}</option>`).join('')}</select></label></div><label class="field"><span>Preferred late-revision rule</span><select id="editMode"><option value="fixed" ${t.defaultLateMode!=='shift'?'selected':''}>Fixed schedule</option><option value="shift" ${t.defaultLateMode==='shift'?'selected':''}>Shift after late completion</option></select></label><label class="field"><span>Notes</span><textarea id="editNotes" rows="2" maxlength="600">${h(t.notes||'')}</textarea></label><div class="form-grid"><label class="field"><span>Revision days</span><input id="editIntervals" value="${h(t.intervals.join(','))}" ${t.history.length?'disabled':''}></label><label class="field"><span>Repeat every N days</span><input id="editCycle" type="number" min="1" max="3650" value="${h(t.cycleDays)}" ${t.history.length?'disabled':''}></label></div><label class="checkline"><input type="checkbox" id="editPaused" ${t.paused?'checked':''}> Pause this topic (hide from pending queues)</label><p class="field-hint">Current stage: R${t.history.length+1}${next?' · due '+fmtDate(next.due):' · finished before cutoff'}. ${t.history.length?'Study date and intervals are locked once revisions are completed to preserve history.':''}</p><details class="advanced"><summary>Revision history (${t.history.length})</summary>${history||'<p class="muted">No completed revisions yet.</p>'}${t.adjustments.length?`<p class="field-hint">${t.adjustments.length} individual schedule adjustment(s) recorded.</p>`:''}</details>`;
 openModal('Edit topic',t.topic,body+modalButtons('Save changes','confirmEdit'));
 wireModalCancel();
 $('confirmEdit').onclick=()=>{
  const title=$('editName').value.trim().replace(/\s+/g,' '),start=$('editStart').value;
  if(!title||title.length>160||!validDate(start)||start>todayKey()){toast('Enter a valid topic name and study date.',true);return;}
  let intervals=t.intervals,cycle=t.cycleDays;if(!t.history.length){try{intervals=parseIntervals($('editIntervals').value);cycle=Number($('editCycle').value);if(!Number.isInteger(cycle)||cycle<1||cycle>3650)throw Error('Repeat interval must be 1–3650 days.');}catch(e){toast(e.message,true);return;}}
  const updated=clone(t);Object.assign(updated,{subject:$('editSubject').value,topic:title,startDate:start,difficulty:$('editDifficulty').value,defaultLateMode:$('editMode').value,notes:$('editNotes').value.trim(),paused:$('editPaused').checked,intervals,cycleDays:cycle});bump(updated);
  if(transaction(()=>state.topics[state.topics.findIndex(x=>x.id===t.id)]=updated,[['topics',updated]])){closeModal();toast('Topic updated.');}
 };
}
function deleteTopic(topicId){const t=topicById(topicId);if(!t)return;
 openModal('Delete topic',t.topic,`<p>Delete <strong>${h(t.topic)}</strong>, including its ${t.history.length} completed revisions? This will also sync to cloud when connected.</p><p class="field-hint">An exported backup is the only straightforward way to restore deleted history.</p>`+`<div class="modal-actions"><button class="outline-btn" data-close-modal>Cancel</button><button class="danger-btn" id="confirmDeleteTopic">Delete topic</button></div>`);
 wireModalCancel();$('confirmDeleteTopic').onclick=()=>{const updated=bump({...t,_deleted:true});if(transaction(()=>state.topics[state.topics.findIndex(x=>x.id===t.id)]=updated,[['topics',updated]])){closeModal();toast('Topic deleted.');}};
}
function renderLibrary(){
 const filter=$('librarySubject').value,status=$('libraryStatus').value,query=$('librarySearch').value.trim().toLowerCase();
 const now=todayKey();let visible=activeTopics().filter(t=>{
 if(filter!=='all'&&t.subject!==filter)return false;
 if(query&&!(t.topic+' '+t.notes+' '+t.subject).toLowerCase().includes(query))return false;
 if(status==='all')return true;
 if(t.paused)return status==='paused';
 const next=getTopicNext(t);
 return status==='finished'?!next:status==='overdue'?next?.due<now:status==='due'?next?.due===now:status==='upcoming'?next?.due>now:false;
 });
 let html='';for(const sub of SUBJECTS){const rows=visible.filter(t=>t.subject===sub);if(!rows.length)continue;
 html+=`<section class="subject-block"><div class="subject-head"><h3>${h(sub)}</h3><span class="subtle-note">${rows.length} topic${rows.length===1?'':'s'}</span></div><div class="topic-list">${rows.map(t=>{
  const next=getTopicNext(t),late=next&&next.due<now,done=t.history.length;
  const flag=t.paused?'Paused':!next?'Cutoff reached':late?'Overdue':next.due===now?'Due today':'Upcoming';
  return `<article class="library-topic"><div class="topic-meta"><span class="badge ${late?'red':t.paused?'gray':''}">${h(flag)}</span><span class="badge gray">${h(t.difficulty||'Moderate')}</span><span class="badge">${done} done</span></div><h4>${h(t.topic)}</h4><p>Day 0: ${h(fmtDate(t.startDate))}</p><p>${next?`Next R${next.number}: ${h(fmtDate(next.due))}`:'No future stages before cutoff'}</p>${t.notes?`<p>${h(t.notes)}</p>`:''}<div class="topic-actions">${!t.paused&&next&&next.due<=now?`<button class="small-btn" data-action="review" data-id="${h(t.id)}">✓ Revise</button>`:''}<button class="small-btn outline" data-action="edit" data-id="${h(t.id)}">Edit / ${t.paused?'resume':'pause'}</button><button class="small-btn outline" data-action="delete" data-id="${h(t.id)}">Delete</button></div></article>`;
 }).join('')}</div></section>`;
 }
 $('subjectLibrary').innerHTML=html||noItems(activeTopics().length?'No topics match this filter.':'Your library is empty. Add your first topic to get started.','▤');
}
function renderCalendar(){
 const now=todayKey(),first=calendarMonth,firstDay=new Date(first+'T12:00:00Z').getUTCDay();const mondayOffset=(firstDay+6)%7;
 const next=monthShift(first,1);const last=addDays(next,-1);$('monthTitle').textContent=new Date(first+'T12:00:00Z').toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'});
 const perDay=new Map();const end=state.settings.examDate&&state.settings.examDate<last?state.settings.examDate:last;
 for(const topic of activeTopics().filter(t=>!t.paused)){
   for(const rev of buildTimeline(topic,end)){
    if(rev.due>=first&&rev.due<=last){if(!perDay.has(rev.due))perDay.set(rev.due,[]);perDay.get(rev.due).push({topic,rev});}
   }
 }
 let html='';for(let i=0;i<mondayOffset;i++)html+='<div class="cal-day blank"></div>';
 for(let day=first;day<next;day=addDays(day,1)){
  const rows=perDay.get(day)||[],pending=rows.filter(x=>!x.rev.completed),done=rows.length-pending.length;
  const logged=activeLogs().some(x=>x.date===day);
  html+=`<button class="cal-day ${day===now?'today':''} ${day===selectedCalendarDay?'selected':''}" data-day="${day}" aria-label="${h(fmtDate(day))}: ${pending.length} revisions pending"><div class="cal-number">${Number(day.slice(8))}</div><div class="cal-chips">${pending.length?`<span class="cal-chip ${day<now?'red':''}">${pending.length} due</span>`:''}${done?`<span class="cal-chip">${done} ✓</span>`:''}${logged?'<span class="cal-chip blue">● study</span>':''}</div></button>`;
 }
 $('calendarGrid').innerHTML=html;
 $('calendarGrid').querySelectorAll('[data-day]').forEach(btn=>btn.onclick=()=>{selectedCalendarDay=btn.dataset.day;renderCalendar();});
 const rows=perDay.get(selectedCalendarDay)||[];
 // For a date outside the displayed month, query a targeted timeline too.
 const chosen=selectedCalendarDay>=first&&selectedCalendarDay<=last?rows:activeTopics().flatMap(t=>buildTimeline(t,selectedCalendarDay).filter(x=>x.due===selectedCalendarDay).map(rev=>({topic:t,rev})));
 const sessions=activeLogs().filter(x=>x.date===selectedCalendarDay);
 $('calendarDetail').innerHTML=`<div class="panel-heading"><div><span class="section-kicker">SELECTED DATE</span><h2>${h(fmtDate(selectedCalendarDay))}</h2></div><span class="badge">${chosen.length} scheduled revisions</span></div>${chosen.length?chosen.map(x=>`<div class="upcoming-row"><span><strong>${h(x.topic.topic)}</strong><div class="task-sub">${h(x.topic.subject)} · R${x.rev.number}${x.rev.completed?' · Completed '+fmtDate(x.rev.record.completedOn):''}</div></span><span class="badge ${x.rev.completed?'':'orange'}">${x.rev.completed?'Done':'Pending'}</span></div>`).join(''):'<p class="muted">No scheduled revisions on this date.</p>'}<p class="field-hint" style="margin-top:13px">${sessions.length} study log(s) · ${fmtHour(sum(sessions,x=>x.hours))}h · ${sum(sessions,x=>x.mcqs)} MCQs</p>`;
}
function captureSession(e){
 e.preventDefault();const date=$('studyDate').value,subject=$('studySubject').value;
 const hrRaw=$('studyHours').value.trim(),mcqRaw=$('studyMcqs').value.trim(),correctRaw=$('studyCorrect').value.trim();
 const hours=hrRaw===''?0:Number(hrRaw),mcqs=mcqRaw===''?0:Number(mcqRaw);
 const correct=correctRaw===''?null:Number(correctRaw);
 if(!validDate(date)||date>todayKey()||hours<0||hours>24||!Number.isFinite(hours)||!Number.isInteger(mcqs)||mcqs<0||mcqs>10000||
 (correct!==null&&(!Number.isInteger(correct)||correct<0||correct>mcqs))||(!hours&&!mcqs)||
 (subject&&!SUBJECTS.includes(subject))){toast('Check the date, hours (0–24), MCQs and correct answers. Enter at least hours or MCQs.',true);return;}
 const item={id:id(),date,subject,hours,mcqs,correct,note:$('studyNote').value.trim(),_deleted:false,_updatedAt:Date.now()};
 if(transaction(()=>state.logs.push(item),[['logs',item]])){
  $('studyHours').value='';$('studyMcqs').value='';$('studyCorrect').value='';$('studyNote').value='';toast('Study session logged.');
 }
}
function calculateMetrics(logs){return {hours:sum(logs,x=>x.hours),mcqs:sum(logs,x=>x.mcqs),correct:sum(logs,x=>x.correct||0),graded:sum(logs,x=>x.correct===null?0:x.mcqs),sessions:logs.length};}
function metricCardData(arr,label){const m=calculateMetrics(arr);return {label,hours:fmtHour(m.hours)+'h',mcqs:m.mcqs,accuracy:m.graded?Math.round(100*m.correct/m.graded)+'%':'—',sessions:m.sessions};}
function niceNumber(x){return x>=1000?(x/1000).toFixed(1)+'k':String(Number(x.toFixed(1)));}
function barChart(values,labels,options={}){
 if(!values.length||!values.some(v=>v>0))return `<div class="no-chart">Not enough activity yet. Add a session or revision to see a graph.</div>`;
 const width=640,height=240,left=44,right=12,top=20,bottom=44,W=width-left-right,H=height-top-bottom;
 const max=Math.max(...values,1),step=W/values.length,barW=Math.max(2,Math.min(28,step*.69)),bars=[];
 for(let i=0;i<values.length;i++){const val=Math.max(0,Number(values[i])||0),bh=val/max*(H-8),x=left+step*i+(step-barW)/2,y=top+H-bh;
  bars.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh,.5).toFixed(1)}" rx="${Math.min(4,barW/2)}" fill="${options.color||'var(--accent)'}"><title>${h(labels[i])}: ${h(niceNumber(val))}</title></rect>`);
 }
 const ticks=[0,.25,.5,.75,1].map(t=>{const y=(top+H-t*H).toFixed(1);return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="var(--line)"/><text x="${left-7}" y="${Number(y)+4}" text-anchor="end" font-size="11" fill="var(--muted)">${h(niceNumber(max*t))}</text>`;}).join('');
 const labelEvery=Math.max(1,Math.ceil(values.length/8));const lbl=labels.map((text,i)=>(i%labelEvery===0||i===labels.length-1)?`<text x="${(left+step*(i+.5)).toFixed(1)}" y="${height-22}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${h(String(text).slice(0,11))}</text>`:'').join('');
 return `<svg role="img" aria-label="${h(options.label||'Bar chart')}" viewBox="0 0 ${width} ${height}">${ticks}${bars.join('')}${lbl}</svg>`;
}
function lineChart(values,labels,options={}){
 if(!values.length||!values.some(v=>v>0))return '<div class="no-chart">No study sessions in this period yet.</div>';
 const width=640,height=238,left=44,right=14,top=19,bottom=43,W=width-left-right,H=height-top-bottom,max=Math.max(1,...values);
 const xy=values.map((v,i)=>({x:left+(values.length===1?W/2:(i/(values.length-1))*W),y:top+H-v/max*H,value:v}));
 const points=xy.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
 const area=`${left},${top+H} ${points} ${left+W},${top+H}`;
 const ticks=[0,.25,.5,.75,1].map(t=>{const y=top+H*(1-t);return `<line x1="${left}" y1="${y}" x2="${left+W}" y2="${y}" stroke="var(--line)"/><text x="${left-7}" y="${y+4}" text-anchor="end" fill="var(--muted)" font-size="11">${h(niceNumber(t*max))}</text>`;}).join('');
 const labelEvery=Math.max(1,Math.ceil(labels.length/7));const lbl=labels.map((txt,i)=>i%labelEvery===0||i===labels.length-1?`<text x="${xy[i].x.toFixed(1)}" y="${height-20}" text-anchor="middle" fill="var(--muted)" font-size="10.5">${h(String(txt).slice(0,10))}</text>`:'').join('');
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${h(options.label||'Line chart')}">${ticks}<polygon points="${area}" fill="var(--accent-soft)" opacity=".62"/><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${xy.map((p,i)=>(values.length<=31||i%Math.ceil(values.length/31)===0)?`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="var(--accent)"><title>${h(labels[i])}: ${h(niceNumber(p.value))}</title></circle>`:'').join('')}${lbl}</svg>`;
}
function renderStudy(){
 const now=todayKey(),[ws,we]=periodDates(now,'week'),[ms,me]=periodDates(now,'month');
 const all=activeLogs(),daily=all.filter(x=>x.date===now),weekly=all.filter(x=>x.date>=ws&&x.date<=we),monthly=all.filter(x=>x.date>=ms&&x.date<=me);
 const today=calculateMetrics(daily),week=calculateMetrics(weekly),month=calculateMetrics(monthly),total=calculateMetrics(all);
 $('studySummaryStats').innerHTML=statCard('Hours today',fmtHour(today.hours)+'h',`${today.sessions} session(s)`,'green')+statCard('MCQs today',today.mcqs,`${today.graded?Math.round(today.correct/today.graded*100)+'% accuracy':'Accuracy not entered'}`)+statCard('This week',fmtHour(week.hours)+'h',`${week.mcqs} MCQs`)+statCard('This month',fmtHour(month.hours)+'h',`${month.mcqs} MCQs`);
 const range=Number($('studyRange').value),metric=$('studyMetric').value;
 const dates=Array.from({length:range},(_,i)=>addDays(now,i-range+1));
 const byDate=new Map();for(const log of all){if(!byDate.has(log.date))byDate.set(log.date,[]);byDate.get(log.date).push(log);}
 const values=dates.map(day=>sum(byDate.get(day)||[],x=>metric==='hours'?x.hours:metric==='mcqs'?x.mcqs:(x.correct||0)));
 $('studyChart').innerHTML=lineChart(values,dates.map(d=>fmtShort(d)),{label:`${metric} for last ${range} days`})+`<div class="chart-legend">Total ${metric}: <strong>${h(niceNumber(sum(values,x=>x)))}</strong> · Active days: ${values.filter(x=>x>0).length}/${range}</div>`;
 const aggMode=$('aggregationMode').value,aggMetric=$('aggregationMetric').value,aggregated=new Map();
 for(const log of all){const key=aggMode==='week'?periodDates(log.date,'week')[0]:aggMode==='month'?log.date.slice(0,7):log.date;
  if(!aggregated.has(key))aggregated.set(key,[]);aggregated.get(key).push(log);
 }
 const groupKeys=[...aggregated.keys()].sort().slice(aggMode==='day'?-30:-16);
 const aggValues=groupKeys.map(k=>sum(aggregated.get(k),x=>aggMetric==='hours'?x.hours:aggMetric==='mcqs'?x.mcqs:(x.correct||0)));
 $('aggregationChart').innerHTML=barChart(aggValues,groupKeys.map(k=>aggMode==='month'?k:fmtShort(k)),{label:`${aggMetric} by ${aggMode}`})+`<div class="chart-legend">${h(aggMetric)} grouped by ${h(aggMode)}. ${h(fmtHour(total.hours))} total hours and ${h(total.mcqs)} total MCQs logged.</div>`;
 const period=$('historyPeriod').value,sub=$('historySubject').value;
 const selected=all.filter(log=>{
  if(sub!=='all'&&log.subject!==sub)return false;
  if(period==='today')return log.date===now;
  if(period==='week')return log.date>=ws&&log.date<=we;
  if(period==='month')return log.date>=ms&&log.date<=me;
  return true;
 }).sort((a,b)=>b.date.localeCompare(a.date)||b._updatedAt-a._updatedAt);
 $('studyHistory').innerHTML=selected.length?selected.slice(0,100).map(log=>`<div class="history-row"><div><strong>${h(fmtDate(log.date))}</strong><span class="badge gray" style="margin-left:7px">${h(log.subject||'Mixed')}</span><div class="history-detail">${h(fmtHour(log.hours))}h · ${log.mcqs} MCQs ${log.correct!==null?'· '+log.correct+' correct':''}${log.note?' · '+h(log.note):''}</div></div><div class="button-group"><button class="small-btn outline" data-action="editLog" data-id="${h(log.id)}">Edit</button><button class="small-btn outline" data-action="deleteLog" data-id="${h(log.id)}">Delete</button></div></div>`).join('')+(selected.length>100?'<p class="muted">Showing 100 most recent sessions. Full history remains in your backup.</p>':''):noItems('No sessions match your filters. Log hours and MCQs above.','◷');
}
function editLog(logId){const log=activeLogs().find(x=>x.id===logId);if(!log)return;
 openModal('Edit study session',fmtDate(log.date),`<div class="form-grid"><label class="field"><span>Date</span><input id="logEditDate" type="date" max="${h(todayKey())}" value="${h(log.date)}"></label><label class="field"><span>Subject</span><select id="logEditSubject">${subjectSelectOptions('General / mixed study')}</select></label></div><div class="form-grid"><label class="field"><span>Hours</span><input id="logEditHours" type="number" min="0" max="24" step="any" value="${h(log.hours)}"></label><label class="field"><span>MCQs attempted</span><input id="logEditMcqs" type="number" min="0" max="10000" value="${h(log.mcqs)}"></label></div><label class="field"><span>MCQs correct (optional)</span><input id="logEditCorrect" type="number" min="0" max="10000" value="${log.correct===null?'':h(log.correct)}"></label><label class="field"><span>Note</span><input id="logEditNote" value="${h(log.note||'')}" maxlength="140"></label>`+modalButtons('Save session','confirmEditLog'));
 $('logEditSubject').value=log.subject;wireModalCancel();
 $('confirmEditLog').onclick=()=>{
 const date=$('logEditDate').value,hours=Number($('logEditHours').value),mcqs=Number($('logEditMcqs').value),craw=$('logEditCorrect').value,correct=craw===''?null:Number(craw);
 if(!validDate(date)||date>todayKey()||!Number.isFinite(hours)||hours<0||hours>24||!Number.isInteger(mcqs)||mcqs<0||mcqs>10000||(!hours&&!mcqs)||(correct!==null&&(!Number.isInteger(correct)||correct<0||correct>mcqs))){toast('Invalid session values.',true);return;}
 const updated=bump({...log,date,subject:$('logEditSubject').value,hours,mcqs,correct,note:$('logEditNote').value.trim()});
 if(transaction(()=>state.logs[state.logs.findIndex(x=>x.id===logId)]=updated,[['logs',updated]])){closeModal();toast('Study session updated.');}
 };
}
function deleteLog(logId){const log=activeLogs().find(x=>x.id===logId);if(!log)return;
 openModal('Delete study session',fmtDate(log.date),`<p>Remove this ${fmtHour(log.hours)}h / ${log.mcqs} MCQ session?</p><div class="modal-actions"><button class="outline-btn" data-close-modal>Cancel</button><button class="danger-btn" id="confirmDeleteLog">Delete</button></div>`);
 wireModalCancel();$('confirmDeleteLog').onclick=()=>{
 const updated=bump({...log,_deleted:true});if(transaction(()=>state.logs[state.logs.findIndex(x=>x.id===logId)]=updated,[['logs',updated]])){closeModal();toast('Session deleted.');}
 };
}
function renderAnalytics(){
 const topics=activeTopics(),logs=activeLogs(),b=currentBuckets(),now=todayKey(),history=topics.flatMap(t=>t.history||[]);
 const allFinished=history.length,completeToday=history.filter(x=>x.completedOn===now).length;
 const onTime=history.filter(x=>x.completedOn<=x.dueDate).length;
 const debt=daysDebt(b);
 $('revisionAnalyticsStats').innerHTML=statCard('Active topics',topics.length,`${SUBJECTS.filter(s=>topics.some(t=>t.subject===s)).length}/19 subjects covered`)+statCard('Completed revisions',allFinished,`${completeToday} today`,'green')+statCard('On-time completion',allFinished?Math.round(100*onTime/allFinished)+'%':'—','Completed on/before scheduled date')+statCard('Revision debt',debt+' days',`${b.overdue.length} pending overdue topics`,'red');
 const stageNames=['R0','R1–2','R3–4','R5+'],stageValues=[0,0,0,0];
 topics.forEach(t=>{const s=t.history.length;stageValues[s===0?0:s<=2?1:s<=4?2:3]++;});
 $('stageChart').innerHTML=barChart(stageValues,stageNames,{label:'Topic counts by revision stage'});
 const subjectRows=SUBJECTS.map(sub=>({sub,topics:topics.filter(t=>t.subject===sub)})).filter(x=>x.topics.length>0);
 $('subjectChart').innerHTML=subjectRows.length?`<div style="display:grid;gap:9px">${subjectRows.map(r=>{
  const mean=sum(r.topics,t=>Math.min(5,t.history.length))/r.topics.length;
  return `<div style="display:grid;grid-template-columns:108px 1fr 67px;align-items:center;gap:8px;font-size:.72rem"><strong style="overflow:hidden;text-overflow:ellipsis">${h(r.sub)}</strong><div class="progress-line" style="margin:0;height:12px"><div class="progress-fill" style="width:${(mean/5*100).toFixed(1)}%"></div></div><span class="muted">${r.topics.length} topics</span></div>`;
 }).join('')}</div><p class="field-hint" style="margin-top:11px">Bar length represents average completed revisions, capped at R5. It is not a validated measure of mastery.</p>`:noItems('Add topics to see subject-wise progress.');
 const range=Number($('forecastRange').value),dates=Array.from({length:range},(_,i)=>addDays(now,i));
 const scores=new Map(dates.map(d=>[d,0]));
 for(const topic of topics.filter(t=>!t.paused))for(const revision of buildTimeline(topic,dates.at(-1))){if(scores.has(revision.due)&&!revision.completed)scores.set(revision.due,scores.get(revision.due)+1);}
 $('forecastChart').innerHTML=barChart(dates.map(d=>scores.get(d)),dates.map(d=>fmtShort(d)),{label:'Upcoming number of revisions by date'});
 const qualities=['Good','Partial','Poor'],counts=qualities.map(q=>history.filter(x=>x.quality===q).length);
 $('qualityChart').innerHTML=barChart(counts,qualities,{label:'Recorded recall quality'});
 const [ws,we]=periodDates(now,'week');const weekly=history.filter(x=>x.completedOn>=ws&&x.completedOn<=we);
 const hard=topics.filter(t=>t.difficulty==='Hard').length;
 const last30=activeLogs().filter(x=>x.date>=addDays(now,-29)&&x.date<=now);
 $('consistencyInsights').innerHTML=`<div class="analytics-insights"><div class="insight"><b>${weekly.length}</b><span>Revisions completed this week</span></div><div class="insight"><b>${hard}</b><span>Hard topics in active library</span></div><div class="insight"><b>${fmtHour(sum(last30,x=>x.hours))}h / ${sum(last30,x=>x.mcqs)}</b><span>Study hours / MCQs over last 30 days</span></div></div><p class="field-hint" style="margin-top:18px">Due dates are calendar dates, not exact timestamps. On-time means completed by the scheduled date. For academic mastery, combine these statistics with actual MCQ performance.</p>`;
}
function renderSettings(){renderCloud();const live=activeTopics().length,logs=activeLogs().length;$('backupDisplay').textContent=`${live} topic(s) and ${logs} study session(s) in the tracker. A JSON export includes both plus settings. Browser downloads cannot be confirmed programmatically.`;}
function saveSettings(e){e.preventDefault();let intervals,cycle;try{intervals=parseIntervals($('settingsIntervals').value);cycle=Number($('settingsCycle').value);if(!Number.isInteger(cycle)||cycle<1||cycle>3650)throw Error('Repeat cycle must be between 1 and 3650 days.');}catch(e){toast(e.message,true);return;}
 const cutoff=$('examDate').value;if(cutoff&&!validDate(cutoff)){toast('Invalid exam date.',true);return;}
 const revisionLimit=Number($('revisionLimit').value);if(!Number.isInteger(revisionLimit)||revisionLimit<1||revisionLimit>2000){toast('Daily load warning limit must be 1–2000.',true);return;}
 const updated=bump({...state.settings,examDate:cutoff,defaultIntervals:intervals,defaultCycle:cycle,revisionLimit,dailyReminder:$('dailyReminder').checked});
 if(transaction(()=>state.settings=updated,[['preferences',updated]])){syncFormSettings();toast('Preferences saved. New topic defaults updated.');}
}
function changeTheme(){const next=theme()==='dark'?'light':'dark';const updated=bump({...state.settings,theme:next});transaction(()=>{state.settings=updated;applyDisplayPrefs();},[['preferences',updated]]);}
function changeFont(delta){const fontSize=minmax((Number(state.settings.fontSize)||16)+delta,13,22),updated=bump({...state.settings,fontSize});transaction(()=>{state.settings=updated;applyDisplayPrefs();},[['preferences',updated]]);}
function download(name,content,mime){
 const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
 toast('Download requested. Please verify the file is in your Downloads folder.');
}
function exportJSON(){const payload={format:'MasterRecall',version:2,exportedAt:new Date().toISOString(),subjects:SUBJECTS,topics:activeTopics().map(t=>clone(t)),logs:activeLogs().map(x=>clone(x)),settings:clone(state.settings)};
 download(`MasterRecall_Backup_${todayKey()}.json`,JSON.stringify(payload,null,2),'application/json');
}
function csvCell(x){const s=String(x??'');return '"'+s.replace(/"/g,'""')+'"';}
function exportCSV(){const columns=['date','subject','hours','mcqs','correct','note'];const lines=[columns.join(',')].concat(activeLogs().map(item=>columns.map(k=>csvCell(item[k])).join(',')));
 download(`MasterRecall_StudyLog_${todayKey()}.csv`,lines.join('\r\n'),'text/csv;charset=utf-8');
}
function validateTopic(t){
 if(!t||typeof t!=='object'||typeof t.id!=='string'||t.id.length>120||!SUBJECTS.includes(t.subject)||typeof t.topic!=='string'||!t.topic.trim()||t.topic.length>160||!validDate(t.startDate)||!Array.isArray(t.intervals)||t.intervals.length<1||t.intervals.length>20||!Number.isInteger(t.cycleDays)||t.cycleDays<1||t.cycleDays>3650)return false;
 try{if(parseIntervals(t.intervals.join(',')).length!==t.intervals.length)return false;}catch{return false;}
 if(!Array.isArray(t.history)||!Array.isArray(t.adjustments)||t.history.length>600||t.adjustments.length>1000)return false;
 if(t.history.some((ev,i)=>ev.index!==i||!validDate(ev.completedOn)||(ev.dueDate&&!validDate(ev.dueDate))||!['fixed','shift'].includes(ev.mode)))return false;
 if(t.adjustments.some(a=>!Number.isInteger(a.fromIndex)||a.fromIndex<0||!Number.isInteger(a.days)||Math.abs(a.days)>3650))return false;
 if(t.notes!==undefined&&typeof t.notes!=='string')return false;
 return true;
}
function validateLog(l){return l&&typeof l.id==='string'&&l.id.length<121&&validDate(l.date)&&(!l.subject||SUBJECTS.includes(l.subject))&&typeof l.hours==='number'&&l.hours>=0&&l.hours<=24&&Number.isInteger(l.mcqs)&&l.mcqs>=0&&l.mcqs<=10000&&(l.correct==null||(Number.isInteger(l.correct)&&l.correct>=0&&l.correct<=l.mcqs))&&typeof(l.note||'')==='string';}
async function importJSON(file){
 if(!file)return;if(file.size>8_000_000){toast('Backup too large (8 MB maximum).',true);return;}
 let payload;
 try{payload=JSON.parse(await file.text());if(payload.format!=='MasterRecall'||payload.version!==2||!Array.isArray(payload.topics)||!Array.isArray(payload.logs)||payload.topics.length>10000||payload.logs.length>20000||!payload.topics.every(validateTopic)||!payload.logs.every(validateLog)||!payload.settings||typeof payload.settings!=='object'||!Array.isArray(payload.settings.defaultIntervals)||!Number.isInteger(payload.settings.defaultCycle)||payload.settings.defaultCycle<1||payload.settings.defaultCycle>3650||(payload.settings.examDate&&!validDate(payload.settings.examDate)))throw Error('Invalid or unsupported Master Recall v2 backup.');
  parseIntervals(payload.settings.defaultIntervals.join(','));
  const ids=[...payload.topics,...payload.logs].map(x=>x.id);if(new Set(ids).size!==ids.length)throw Error('Duplicate record IDs.');
 }catch(e){toast(`Import rejected: ${e.message}`,true);$('importFile').value='';return;}
 if(!confirm(`Replace your current ${activeTopics().length} topics and ${activeLogs().length} sessions with ${payload.topics.length} topics and ${payload.logs.length} sessions from the backup? This also syncs deletions when cloud is connected.`)){$('importFile').value='';return;}
 // Preserve tombstones for records removed by the restore, so another device cannot resurrect them.
 const now=Date.now(),incomingTopicIds=new Set(payload.topics.map(x=>x.id)),incomingLogIds=new Set(payload.logs.map(x=>x.id));
 const missingTopics=state.topics.filter(x=>!incomingTopicIds.has(x.id)).map((x,i)=>bump({...x,_deleted:true,_updatedAt:now+i}));
 const missingLogs=state.logs.filter(x=>!incomingLogIds.has(x.id)).map((x,i)=>bump({...x,_deleted:true,_updatedAt:now+20000+i}));
 const importedTopics=payload.topics.map((x,i)=>({...x,_deleted:false,_updatedAt:Math.max(Date.now(),x._updatedAt||0)+i+1}));
 const importedLogs=payload.logs.map((x,i)=>({...x,_deleted:false,_updatedAt:Math.max(Date.now(),x._updatedAt||0)+i+1}));
 const settings=bump({...state.settings,...payload.settings,id:'main'});
 const writes=[...missingTopics,...importedTopics].map(x=>['topics',x]).concat([...missingLogs,...importedLogs].map(x=>['logs',x]),[['preferences',settings]]);
 const success=transaction(()=>{state.topics=[...missingTopics,...importedTopics];state.logs=[...missingLogs,...importedLogs];state.settings=settings;applyDisplayPrefs();},writes);
 $('importFile').value='';if(success){syncFormSettings();toast('Backup imported successfully.');}
}
function resetAll(){
 openModal('Reset tracker content','Keep display preferences and subject list',`<p>This will remove <strong>${activeTopics().length} topics</strong> and <strong>${activeLogs().length} study sessions</strong>. In cloud mode, deletion will propagate to connected devices.</p><label class="field"><span>Type <strong>DELETE</strong> to confirm</span><input id="resetConfirm" autocomplete="off" placeholder="DELETE"></label><p class="field-hint">Export your backup first if you may need the history again.</p><div class="modal-actions"><button class="outline-btn" data-close-modal>Cancel</button><button class="danger-btn" id="confirmReset">Delete tracker data</button></div>`);
 wireModalCancel();$('confirmReset').onclick=()=>{
 if($('resetConfirm').value!=='DELETE'){toast('Type DELETE to confirm.',true);return;}
 const updatedTopics=state.topics.map(x=>x._deleted?x:bump({...x,_deleted:true}));
 const updatedLogs=state.logs.map(x=>x._deleted?x:bump({...x,_deleted:true}));
 const writes=[...updatedTopics.filter(x=>!state.topics.find(v=>v.id===x.id)?._deleted).map(x=>['topics',x]),...updatedLogs.filter(x=>!state.logs.find(v=>v.id===x.id)?._deleted).map(x=>['logs',x])];
 if(transaction(()=>{state.topics=updatedTopics;state.logs=updatedLogs;},writes)){closeModal();toast('Tracker data cleared. Preferences remain.');}
 };
}
function normalizeRemote(kind,item){
 if(kind==='topics')return validateTopic(item)?item:null;
 if(kind==='logs')return validateLog(item)?item:null;
 if(kind==='preferences')return item?.id==='main'&&typeof item._updatedAt==='number'?item:null;
 return null;
}
function onCloudRows(kind,rows,metadata){
 if(!cloudUser)return;
 const localList=kind==='preferences'?[state.settings]:state[kind];
 let changed=false;const remoteIds=new Set();
 for(const entry of rows){const item=normalizeRemote(kind,entry);if(!item)continue;remoteIds.add(item.id);
  const local=localList.find(x=>x.id===item.id);
  if(!local || Number(item._updatedAt)>Number(local._updatedAt||0)){
   if(kind==='preferences'){state.settings={...state.settings,...item};applyDisplayPrefs();}
   else{const i=state[kind].findIndex(x=>x.id===item.id);if(i===-1)state[kind].push(item);else state[kind][i]=item;}
   changed=true;
  } else if(local&&Number(local._updatedAt)>Number(item._updatedAt||0) && !metadata.fromCache){
   cloud?.write(kind,clone(local)).catch(error=>{cloudStatus='error';cloudStatusDetail=error.message;renderCloud();});
  }
 }
 // Missing remote docs are only uploaded after a confirmed server snapshot.
 // Otherwise an empty offline cache could be mistaken for an empty cloud database.
 if(!metadata.fromCache){
  for(const local of (kind==='preferences'?[state.settings]:state[kind])){
   if(!remoteIds.has(local.id)){cloud?.write(kind,clone(local)).catch(error=>{cloudStatus='error';cloudStatusDetail=error.message;renderCloud();});}
  }
 }
 if(changed){persist();renderAll();if(kind==='preferences')syncFormSettings();}
}
function onCloudAuth(user){
 if(user){
  if(state.userScope && state.userScope!==user.uid){
   // Prevent silently uploading a different person's cloud database into this account.
   const other=localStorage.getItem(`${STORAGE}-account-${user.uid}`);
   if(other){try{state=JSON.parse(other);}catch{state=localDefault();}}
   else state=localDefault();
   toast('Switched to a separate account workspace.');
  }
  state.userScope=user.uid;persist();cloudUser=user;cloudStatus='syncing';
 }else{cloudUser=null;cloudStatus=cloud?'signed-out':'unconfigured';}
 renderAll();
}
function cloudOnStatus(status,detail=''){
 cloudStatus=status;cloudStatusDetail=detail;renderCloud();
 if(status==='error')toast('Cloud sync error: '+detail,true);
}
async function bootCloud(){
 if(cloud||cloudBusy)return;
 cloudBusy=true;
 const config=window.MASTER_RECALL_FIREBASE||{};
 try{
  cloud=await createCloud(config,{onAuth:onCloudAuth,onStatus:cloudOnStatus,onCollection:onCloudRows});
 }catch(e){cloudStatus='error';cloudStatusDetail=`Firebase unavailable: ${e.message}. Local tracker remains usable.`;renderCloud();}
 finally{cloudBusy=false;renderCloud();}
}
async function cloudSignIn(){
 if(!window.MASTER_RECALL_FIREBASE?.apiKey){toast('Cloud not configured. Open firebase-config.js and follow README setup.',true);setView('settings');return;}
 if(!cloud)await bootCloud();if(!cloud){toast(cloudStatusDetail||'Cloud connection unavailable. Try again while online.',true);return;}
 try{await cloud.signIn();toast('Signed in. Syncing your records…');}catch(e){toast(`Sign-in failed: ${e.code||e.message}`,true);}
}
async function cloudSignOut(){if(!cloud||!cloudUser)return;try{await cloud.signOut();toast('Signed out. Your local copy stays on this device.');}catch(e){toast(e.message,true);}}
function bindEvents(){
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
 document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.go)));
 $('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');
 $('themeBtn').onclick=changeTheme;$('settingsThemeBtn').onclick=changeTheme;
 $('fontMinus').onclick=()=>changeFont(-1);$('fontPlus').onclick=()=>changeFont(1);
 $('settingsFontBtn').onclick=()=>changeFont(16-(state.settings.fontSize||16));
 $('cloudButton').onclick=()=>setView('settings');
 $('topicForm').addEventListener('submit',createTopic);
 document.querySelectorAll('[data-addmode]').forEach(b=>b.onclick=()=>setAddMode(b.dataset.addmode));
 $('topicIntervals').oninput=updateAddPreview;$('topicCycle').oninput=updateAddPreview;$('topicStartDate').onchange=updateAddPreview;
 for(const name of ['librarySubject','libraryStatus'])$(name).onchange=renderLibrary;
 $('librarySearch').oninput=renderLibrary;
 $('prevMonth').onclick=()=>{calendarMonth=monthShift(calendarMonth,-1);renderCalendar();};
 $('nextMonth').onclick=()=>{calendarMonth=monthShift(calendarMonth,1);renderCalendar();};
 $('jumpToday').onclick=()=>{calendarMonth=todayKey().slice(0,7)+'-01';selectedCalendarDay=todayKey();renderCalendar();};
 $('studyForm').onsubmit=captureSession;
 for(const name of ['studyRange','studyMetric','aggregationMode','aggregationMetric','historyPeriod','historySubject'])$(name).onchange=renderStudy;
 $('forecastRange').onchange=renderAnalytics;
 $('settingsForm').onsubmit=saveSettings;
 $('signInBtn').onclick=cloudSignIn;$('signOutBtn').onclick=cloudSignOut;
 $('exportBtn').onclick=exportJSON;$('exportCsvBtn').onclick=exportCSV;
 $('importFile').onchange=e=>importJSON(e.target.files[0]);$('resetBtn').onclick=resetAll;
 // One delegated event listener handles every dynamically rendered topic/session control.
 $('content').addEventListener('click',event=>{
  const btn=event.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,topicId=btn.dataset.id;
  if(action==='review')reviewTopic(topicId);
  if(action==='postpone')postponeTopic(topicId);
  if(action==='edit')editTopic(topicId);
  if(action==='delete')deleteTopic(topicId);
  if(action==='editLog')editLog(topicId);
  if(action==='deleteLog')deleteLog(topicId);
 });
 window.addEventListener('online',()=>{if(!cloud)bootCloud();else if(cloudUser)cloudOnStatus('syncing');});
 window.addEventListener('offline',()=>{if(cloudUser)cloudOnStatus('offline');});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tickDate();});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modalHost').classList.contains('hidden'))closeModal();});
}
let lastKnownDay=todayKey();
function tickDate(){renderHeader();const current=todayKey();if(current!==lastKnownDay){lastKnownDay=current;prepareNewDate();if(currentView==='dashboard')renderDashboard();else renderCurrent();}}
function initialize(){
 setupSelects();applyDisplayPrefs();syncFormSettings();prepareNewDate();bindEvents();setAddMode('today');renderAll();
 if(bootIssue)alertBanner(bootIssue);
 setInterval(tickDate,60000);
 if('serviceWorker' in navigator&&location.protocol!=='file:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline service worker unavailable:',e.message)));
 bootCloud();
}
initialize();
