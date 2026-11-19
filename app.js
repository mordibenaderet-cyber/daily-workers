'use strict';
(() => {
  const DB_NAME = 'mordi-daily-workers';
  const DB_VERSION = 1;
  const $ = id => document.getElementById(id);
  const state = { workers: [], assignments: [], currentDate: localISO(new Date()), activeTab: 'daily', workerEditId: null, assignmentEditId: null, photoDraft: null, toastTimer: null, reportRows: [] };

  function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function isoDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T12:00:00`); return !Number.isNaN(d.getTime()) && localISO(d) === value; }
  function addDays(s, number) { const [y,m,d] = s.split('-').map(Number); const value = new Date(y,m-1,d,12); value.setDate(value.getDate()+number); return localISO(value); }
  function niceDate(s) { return new Intl.DateTimeFormat('he-IL', {weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${s}T12:00:00`)); }
  function shortDate(s) { return s.split('-').reverse().join('/'); }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function unique(values) { return [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he')); }
  const clean = value => String(value??'').trim();
  const newId = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const workerById = id => state.workers.find(w=>w.id===id);
  const isImageData = s => typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s) && s.length < 600000;
  function avatar(w, className='avatar') { return `<div class="${className}">${w?.photo && isImageData(w.photo) ? `<img src="${w.photo}" alt="תמונת ${esc(w.name)}">` : '👷'}</div>`; }
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove('visible'),3400); }

  function openDB() { return new Promise((resolve,reject)=>{ const r=indexedDB.open(DB_NAME,DB_VERSION); r.onupgradeneeded=()=>{ const db=r.result; if (!db.objectStoreNames.contains('workers')) db.createObjectStore('workers',{keyPath:'id'}); if(!db.objectStoreNames.contains('assignments')) db.createObjectStore('assignments',{keyPath:'id'}); }; r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); }
  let db;
  async function tableOp(table,mode,operation) { return new Promise((resolve,reject)=>{ const tx=db.transaction(table,mode); let result; let err; const request=operation(tx.objectStore(table)); request.onsuccess=()=>{result=request.result;}; request.onerror=()=>{err=request.error;}; tx.oncomplete=()=>resolve(result); tx.onerror=()=>reject(tx.error || err); tx.onabort=()=>reject(tx.error||err||new Error('Transaction aborted')); }); }
  async function load() { [state.workers,state.assignments]=await Promise.all([tableOp('workers','readonly',s=>s.getAll()),tableOp('assignments','readonly',s=>s.getAll())]); }
  async function write(table,data) { await tableOp(table,'readwrite',s=>s.put(data)); await load(); renderAll(); }
  async function remove(table,id) { await tableOp(table,'readwrite',s=>s.delete(id)); await load(); renderAll(); }
  async function bulkInsert(table,items) { if (!items.length) return; await new Promise((resolve,reject)=>{const tx=db.transaction(table,'readwrite');const store=tx.objectStore(table);for(const item of items)store.put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});await load();renderAll(); }

  function nav(tab) { state.activeTab=tab; document.querySelectorAll('.tab').forEach(b=>{ const isActive=b.dataset.tab===tab; b.classList.toggle('active',isActive); if(isActive)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); }); document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${tab}`)); renderAll(); }
  function renderAll() { populateCompanies(); populateDatalists(); renderStats(); renderDaily(); renderWorkers(); if(state.activeTab==='reports')renderReport(); }
  function populateCompanies() { const companies=unique(state.workers.map(w=>w.company)); const selectors=[$('daily-company-filter'),$('report-company')]; selectors.forEach(s=>{const prev=s.value;s.innerHTML='<option value="">כל החברות</option>'+companies.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');s.value=companies.includes(prev)?prev:'';}); }
  function populateDatalists() { $('company-options').innerHTML=unique(state.workers.map(w=>w.company)).map(v=>`<option value="${esc(v)}"></option>`).join(''); $('location-options').innerHTML=unique(state.assignments.flatMap(a=>workItems(a).map(x=>x.location))).map(v=>`<option value="${esc(v)}"></option>`).join(''); }
  // Single worker/day assignment, containing any number of performed work items.
  // Legacy v1 assignments without workItems are read as one item, preserving old data.
  function workItems(a) {
    if (Array.isArray(a.workItems) && a.workItems.length) return a.workItems;
    return [{location:a.location||'',task:a.task||''}];
  }
  function workerDayCount(rows) { return new Set(rows.map(a=>`${a.workerId}|${a.date}`)).size; }
  function allWorkRows(rows) { return rows.flatMap(a=>workItems(a).map(item=>({assignment:a,item}))); }
  function todayAssignments() { return state.assignments.filter(a=>a.date===state.currentDate && workerById(a.workerId)); }
  function renderStats() {
    const items=todayAssignments(), active=state.workers.filter(w=>w.active!==false).length;
    const sites=unique(items.flatMap(a=>workItems(a).map(x=>x.location))).length;
    const values=[{v:active,l:'פועלים פעילים',i:'👷'},{v:items.length,l:'פועלים ששובצו',i:'📍'},{v:sites,l:'מיקומים רשומים',i:'🏗️'}];
    $('daily-stats').innerHTML=values.map(a=>`<div class="stat-card"><div class="stat-icon">${a.i}</div><div><div class="stat-value">${a.v}</div><div class="stat-label">${a.l}</div></div></div>`).join('');
    $('daily-date').value=state.currentDate;
  }
  function renderDaily() {
    const search=clean($('daily-search').value).toLowerCase(), company=$('daily-company-filter').value;
    const items=todayAssignments().filter(a=>{
      const w=workerById(a.workerId);
      const searchable=[w.name,w.company,a.manager,...workItems(a).flatMap(x=>[x.location,x.task])].join(' ').toLowerCase();
      return (!company||w.company===company)&&(!search||searchable.includes(search));
    }).sort((a,b)=>workerById(a.workerId).name.localeCompare(workerById(b.workerId).name,'he'));
    const out=$('daily-list');
    if(!state.workers.length){out.innerHTML=emptyHTML('עדיין אין פועלים','מתחילים בהוספת כרטיס עובד עם תמונה, שם וחברת כוח אדם.','הוסף פועל ראשון','empty-new-worker');return;}
    if(!items.length){out.innerHTML=search||company?emptyHTML('אין תוצאות לחיפוש','נסה שם אחר או הסר את הסינון.','',''):emptyHTML('אין שיבוצים לתאריך הזה','לחץ על שיבוץ פועל כדי להגדיר איפה כל עובד נמצא.','שיבוץ פועל','empty-new-assignment');return;}
    out.innerHTML=`<div class="day-list-intro">${items.length} פועלים · ${allWorkRows(items).length} רישומי מיקום / מלאכה</div>` + items.map(a=>{
      const w=workerById(a.workerId),entries=workItems(a);
      return `<article class="assignment-card workday-card">${avatar(w)}<div class="assignment-main"><div class="worker-title"><strong>${esc(w.name)}</strong><span class="company-pill">${esc(w.company)}</span><span class="entries-pill">${entries.length} ${entries.length===1?'רישום':'רישומים'}</span></div><div class="workday-entries">${entries.map((x,i)=>`<div class="workday-entry"><span class="entry-number">${i+1}</span><div><div class="work-location">📍 ${esc(x.location)}</div><div class="work-details">${x.task?'🔧 '+esc(x.task):'<span class="not-filled">מלאכה טרם הוזנה</span>'}</div></div></div>`).join('')}</div>${a.manager?`<div class="workday-manager">מנהל עבודה: ${esc(a.manager)}</div>`:''}</div><div class="card-actions"><button class="small-action primary-action" type="button" data-add-work-assignment="${esc(a.id)}">＋ הוסף עבודה</button><button class="small-action" data-edit-assignment="${esc(a.id)}" type="button">עריכת יום</button><button class="small-action danger" data-delete-assignment="${esc(a.id)}" type="button">הסרה</button></div></article>`;
    }).join('');
  }
  function emptyHTML(title,description,button,id) { return `<div class="empty-state"><div class="empty-icon">🗂️</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${button?`<button class="button button-primary" id="${id}" type="button">＋ ${esc(button)}</button>`:''}</div>`; }
  function renderWorkers() {
    const search=clean($('worker-search').value).toLowerCase(), filter=$('workers-status-filter').value;
    const items=state.workers.filter(w=>(filter==='all'||(filter==='active'?w.active!==false:w.active===false))&&(!search||[w.name,w.company].join(' ').toLowerCase().includes(search))).sort((a,b)=>a.name.localeCompare(b.name,'he'));
    $('workers-summary').textContent=`${items.length} פועלים מוצגים • ${state.workers.filter(w=>w.active!==false).length} פעילים במאגר`;
    $('workers-list').innerHTML=items.length?items.map(w=>`<article class="worker-card">${avatar(w)}<div class="worker-info"><strong>${esc(w.name)}</strong><small>${esc(w.company)}</small>${w.active===false?'<small class="archived">לא פעיל</small>':''}</div><div class="card-actions"><button class="small-action" data-history-worker="${esc(w.id)}" type="button">היסטוריה</button><button class="small-action" data-edit-worker="${esc(w.id)}" type="button">עריכה</button><button class="small-action" data-assign-worker="${esc(w.id)}" type="button">שיבוץ</button></div></article>`).join(''):emptyHTML('אין פועלים להצגה',state.workers.length?'לא נמצאו פועלים שמתאימים לסינון.':'הוסף פועל כדי להתחיל.','הוסף פועל','empty-new-worker');
  }
  function openHistory(id) {
    const w=workerById(id);if(!w)return;
    const rows=state.assignments.filter(a=>a.workerId===id).sort((a,b)=>b.date.localeCompare(a.date));
    const entries=allWorkRows(rows).length;
    $('history-dialog-title').textContent=`היסטוריית העבודה של ${w.name}`;
    $('history-content').innerHTML=`<div class="history-profile">${avatar(w)}<div><strong>${esc(w.name)}</strong><small>${esc(w.company)}</small></div><span class="history-count">${rows.length} ימים · ${entries} רישומים</span></div>${rows.length?`<div class="history-list">${rows.map(a=>`<div class="history-row"><div><strong>${shortDate(a.date)}</strong>${workItems(a).map(x=>`<span>📍 ${esc(x.location)}</span><small>מלאכה: ${esc(x.task||'לא הוזנה')}</small>`).join('')}${a.manager?`<small>מנהל עבודה: ${esc(a.manager)}</small>`:''}</div><button class="small-action" type="button" data-history-date="${a.date}">הצג יום</button></div>`).join('')}</div>`:'<div class="history-empty">עדיין אין שיבוצים לפועל זה.</div>'}`;
    showDialog('history-dialog');
  }
  function showDialog(id) { $(id).showModal(); }
  function hideDialog(id) { $(id).close(); }

  function openWorker(id=null) {
    state.workerEditId=id; const w=id?workerById(id):null; $('worker-form').reset(); $('worker-dialog-title').textContent=w?'עריכת כרטיס פועל':'הוספת פועל';$('worker-name').value=w?.name||'';$('worker-company').value=w?.company||'';$('worker-active').checked=w?.active!==false;$('worker-active-wrap').style.display=w?'flex':'none';state.photoDraft=w?.photo||null;$('worker-photo').value=''; renderPhotoPreview();showDialog('worker-dialog');
  }
  function renderPhotoPreview(){const el=$('worker-photo-preview');el.innerHTML=state.photoDraft && isImageData(state.photoDraft)?`<img src="${state.photoDraft}" alt="תצוגה מקדימה">`:'👷';$('remove-worker-photo').style.display=state.photoDraft?'inline-flex':'none';}
  async function makeSmallPhoto(file) { if(!file.type.startsWith('image/'))throw new Error('יש לבחור קובץ תמונה'); if(file.size>20*1024*1024)throw new Error('התמונה גדולה מדי (מעל 20MB)'); const url=URL.createObjectURL(file);let img;try{img=new Image();img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}const max=380,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)), canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/jpeg',.73);if(!isImageData(result))throw new Error('לא ניתן לשמור את התמונה');return result; }
  async function saveWorker(e) {e.preventDefault();const name=clean($('worker-name').value),company=clean($('worker-company').value);if(!name||!company)return toast('יש למלא שם וחברת כוח אדם');const original=state.workerEditId?workerById(state.workerEditId):null;const data={id:original?.id||newId(),name,company,photo:state.photoDraft,active:original?$('worker-active').checked:true};try{await write('workers',data);hideDialog('worker-dialog');toast(original?'פרטי הפועל עודכנו':'הפועל נוסף למאגר');}catch(err){console.error(err);toast('לא ניתן לשמור. בדוק שיש מספיק מקום בזיכרון.');}}

  function workRowHTML(item={location:'',task:''}) {
    return `<div class="work-item-row"><div class="work-item-top"><strong class="work-item-index">מיקום ומלאכה</strong><button type="button" class="remove-work-item" aria-label="הסר שורת עבודה">הסר ✕</button></div><label class="form-field">מיקום עבודה <span class="required">*</span><input class="work-item-location" type="text" list="location-options" required maxlength="160" placeholder="למשל: בניין 4, קומה 3" value="${esc(item.location)}"></label><label class="form-field">מלאכה / עבודה שבוצעה <span class="optional">אפשר להשלים בסוף היום</span><input class="work-item-task" type="text" maxlength="200" placeholder="למשל: תיקוני טיח, ניקיון, יציקות..." value="${esc(item.task)}"></label></div>`;
  }
  function refreshWorkRowLabels() {
    const rows=[...$('assignment-work-items').querySelectorAll('.work-item-row')];
    rows.forEach((r,i)=>{
      r.querySelector('.work-item-index').textContent=`רישום ${i+1}`;
      r.querySelector('.remove-work-item').disabled=rows.length===1;
    });
    $('work-items-count').textContent=`${rows.length} ${rows.length===1?'רישום':'רישומים'}`;
  }
  function appendWorkRow(item={location:'',task:''},focus=false) {
    $('assignment-work-items').insertAdjacentHTML('beforeend',workRowHTML(item));
    refreshWorkRowLabels();
    if(focus)$('assignment-work-items').lastElementChild.querySelector('.work-item-location').focus();
  }
  function openAssignment(id=null,preferredWorkerId=null,addBlank=false) {
    state.assignmentEditId=id;
    const a=id?state.assignments.find(x=>x.id===id):null;
    $('assignment-form').reset();
    $('assignment-dialog-title').textContent=a?'סיכום ועריכת יום עבודה':'שיבוץ פועל / יום עבודה';
    $('assignment-date').value=a?.date||state.currentDate;
    const allowed=state.workers.filter(w=>w.active!==false||w.id===a?.workerId||w.id===preferredWorkerId).sort((x,y)=>x.name.localeCompare(y.name,'he'));
    $('assignment-worker').innerHTML='<option value="">בחר פועל</option>'+allowed.map(w=>`<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.company)}${w.active===false?' (לא פעיל)':''}</option>`).join('');
    $('assignment-worker').value=a?.workerId||preferredWorkerId||'';
    $('assignment-manager').value=a?.manager||'';
    $('assignment-work-items').innerHTML='';
    for(const item of a?workItems(a):[{location:'',task:''}])appendWorkRow(item);
    if(addBlank)appendWorkRow();
    showDialog('assignment-dialog');
    if(addBlank)$('assignment-work-items').lastElementChild.querySelector('.work-item-location').focus();
  }
  async function saveAssignment(e) {
    e.preventDefault();
    const date=$('assignment-date').value,workerId=$('assignment-worker').value,manager=clean($('assignment-manager').value);
    const workItems=[...$('assignment-work-items').querySelectorAll('.work-item-row')].map(row=>({location:clean(row.querySelector('.work-item-location').value),task:clean(row.querySelector('.work-item-task').value)}));
    if(!isoDate(date)||!workerById(workerId)||!workItems.length||workItems.some(x=>!x.location)) {toast('יש לבחור תאריך, פועל ומיקום לכל שורת עבודה');return;}
    if(state.assignments.some(a=>a.date===date&&a.workerId===workerId&&a.id!==state.assignmentEditId)){toast('לפועל כבר קיים יום עבודה בתאריך זה. פתח את "עריכת יום" כדי להוסיף מיקומים ומלאכות.');return;}
    const a={id:state.assignmentEditId||newId(),date,workerId,manager,workItems};
    try{await write('assignments',a);hideDialog('assignment-dialog');state.currentDate=date;renderAll();toast(state.assignmentEditId?'יום העבודה עודכן':'יום העבודה נשמר');}
    catch(err){console.error(err);toast('שמירת יום העבודה נכשלה');}
  }
  async function deleteAssignment(id) {
    const a=state.assignments.find(x=>x.id===id);if(!a)return;
    const w=workerById(a.workerId);
    if(!confirm(`למחוק את כל רישומי העבודה של ${w?.name||'הפועל'} בתאריך ${shortDate(a.date)}?`))return;
    try{await remove('assignments',id);toast('יום העבודה הוסר');}catch(err){console.error(err);toast('הסרת יום העבודה נכשלה');}
  }
  async function copyPrevious() {
    const prev=addDays(state.currentDate,-1), current=new Set(todayAssignments().map(a=>a.workerId));
    const items=state.assignments.filter(a=>a.date===prev&&!current.has(a.workerId)&&workerById(a.workerId)?.active!==false).map(a=>({id:newId(),workerId:a.workerId,date:state.currentDate,manager:a.manager||'',workItems:workItems(a).map(x=>({location:x.location,task:''}))}));
    if(!items.length)return toast('אין שיבוצים פנויים להעתקה מאתמול');
    try{await bulkInsert('assignments',items);toast(`הועתקו ${items.length} שיבוצים מ-${shortDate(prev)} (ללא מלאכות)`);}catch(err){console.error(err);toast('העתקת השיבוצים נכשלה');}
  }

  function getReportRows() {
    const from=$('report-from').value,to=$('report-to').value,company=$('report-company').value;
    if(!isoDate(from)||!isoDate(to)||from>to){toast('בחר טווח תאריכים תקין');return null;}
    return state.assignments.filter(a=>a.date>=from&&a.date<=to&&workerById(a.workerId)&&(!company||workerById(a.workerId).company===company)).sort((a,b)=>a.date.localeCompare(b.date)||workerById(a.workerId).name.localeCompare(workerById(b.workerId).name,'he'));
  }
  function renderReport() {
    const rows=getReportRows();if(!rows)return;state.reportRows=rows;
    const flat=allWorkRows(rows),workerIds=unique(rows.map(a=>a.workerId));
    const from=$('report-from').value,to=$('report-to').value,title=`דוח יומיות: ${shortDate(from)} – ${shortDate(to)}`;
    const head=`<div class="report-heading"><h2 class="report-subheading">${title}</h2><button type="button" class="button button-quiet" id="print-report">הדפסה / שמירה כ-PDF</button></div><div class="report-print"><h1>ניהול יומיות — פירוט מיקומים ומלאכות</h1><p>${esc(title)}</p></div>`;
    if(!rows.length){$('report-result').innerHTML=head+emptyHTML('אין שיבוצים בטווח שבחרת','שנה את התאריכים או חברת כוח האדם.','','');return;}
    const summary=workerIds.map(id=>{const w=workerById(id),days=rows.filter(a=>a.workerId===id);return {name:w.name,company:w.company,days:days.length,entries:allWorkRows(days).length};}).sort((a,b)=>b.days-a.days||a.name.localeCompare(b.name,'he'));
    $('report-result').innerHTML=head+`<div class="report-overview"><span>${workerDayCount(rows)} ימי פועל (ללא ספירה כפולה)</span><span>${flat.length} רישומי עבודות</span><span>${workerIds.length} פועלים</span><span>${unique(flat.map(x=>x.item.location)).length} מיקומים</span></div><h3 class="report-subheading">סיכום לפי פועל</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>פועל</th><th>חברת כוח אדם</th><th>ימי שיבוץ</th><th>מיקומים / מלאכות</th></tr></thead><tbody>${summary.map(w=>`<tr><td>${esc(w.name)}</td><td>${esc(w.company)}</td><td>${w.days}</td><td>${w.entries}</td></tr>`).join('')}</tbody></table></div><h3 class="report-subheading">פירוט עבודה לפי יום ומיקום</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>תאריך</th><th>שם הפועל</th><th>חברת כוח אדם</th><th>מיקום עבודה</th><th>מלאכה</th><th>מנהל עבודה</th></tr></thead><tbody>${flat.map(({assignment:a,item})=>{const w=workerById(a.workerId);return `<tr><td>${shortDate(a.date)}</td><td>${esc(w.name)}</td><td>${esc(w.company)}</td><td>${esc(item.location)}</td><td>${esc(item.task)}</td><td>${esc(a.manager)}</td></tr>`;}).join('')}</tbody></table></div><p class="report-disclaimer">מספר ימי השיבוץ נספר לפי פועל ותאריך, גם אם בוצעו מספר מלאכות או עבודה במספר מיקומים באותו יום.</p>`;
  }
  function downloadFile(name,blob){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function exportCSV(){
    const rows=getReportRows();if(!rows)return;
    const details=allWorkRows(rows),heading=['תאריך','שם הפועל','חברת כוח אדם','מיקום עבודה','מלאכה','מנהל עבודה'];
    const escapeCSV=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const lines=[heading,...details.map(({assignment:a,item})=>{const w=workerById(a.workerId);return [shortDate(a.date),w.name,w.company,item.location,item.task||'',a.manager||''];})].map(row=>row.map(escapeCSV).join(','));
    const csv='\uFEFF'+lines.join('\r\n');
    downloadFile(`daily-workers-${$('report-from').value}-to-${$('report-to').value}.csv`,new Blob([csv],{type:'text/csv;charset=utf-8'}));
    toast(`יוצאו ${details.length} שורות עבודה (${workerDayCount(rows)} ימי פועל)`);
  }
  function exportBackup(){const payload={app:'mordi-daily-workers',version:2,exportedAt:new Date().toISOString(),workers:state.workers,assignments:state.assignments};downloadFile(`daily-workers-backup-${localISO(new Date())}.json`,new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));toast('הגיבוי המלא ירד למכשיר');}
  function validateBackup(raw) {
    if(!raw||raw.app!=='mordi-daily-workers'||!Array.isArray(raw.workers)||!Array.isArray(raw.assignments)||raw.workers.length>5000||raw.assignments.length>100000)throw new Error('קובץ גיבוי לא מתאים');
    const ids=new Set(),workers=raw.workers.map(w=>{
      if(!w||typeof w.id!=='string'||!w.id||ids.has(w.id)||!clean(w.name)||!clean(w.company))throw new Error('נתוני עובדים שגויים');
      ids.add(w.id);return {id:w.id.slice(0,120),name:clean(w.name).slice(0,100),company:clean(w.company).slice(0,100),active:w.active!==false,photo:isImageData(w.photo)?w.photo:null};
    });
    const seen=new Set(),aIds=new Set(),assignments=raw.assignments.map(a=>{
      if(!a||typeof a.id!=='string'||!a.id||aIds.has(a.id)||!ids.has(a.workerId)||!isoDate(a.date))throw new Error('נתוני שיבוצים שגויים');
      const items=Array.isArray(a.workItems)?a.workItems:[{location:a.location,task:a.task}];
      if(items.length<1||items.length>200||items.some(x=>!x||typeof x.location!=='string'||!clean(x.location)||clean(x.location).length>160||clean(x.task).length>200))throw new Error('נתוני שיבוצים שגויים');
      aIds.add(a.id);
      const k=`${a.workerId}|${a.date}`;if(seen.has(k))throw new Error('יש שיבוצים כפולים באותו יום');seen.add(k);
      return {id:a.id.slice(0,120),workerId:a.workerId,date:a.date,manager:clean(a.manager).slice(0,100),workItems:items.map(x=>({location:clean(x.location),task:clean(x.task)}))};
    });
    return {workers,assignments};
  }
  async function importBackup(file){try{if(file.size>40*1024*1024)throw new Error('קובץ הגיבוי גדול מדי');const raw=JSON.parse(await file.text());const data=validateBackup(raw);if(!confirm(`לשחזר ${data.workers.length} פועלים ו-${data.assignments.length} שיבוצים?\n\nפעולה זו תחליף את כל המידע הנוכחי במכשיר. מומלץ להוריד קודם גיבוי.`))return;await new Promise((resolve,reject)=>{const tx=db.transaction(['workers','assignments'],'readwrite');const w=tx.objectStore('workers'),a=tx.objectStore('assignments');w.clear();a.clear();for(const row of data.workers)w.put(row);for(const row of data.assignments)a.put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});await load();renderAll();toast('הגיבוי שוחזר בהצלחה');}catch(err){console.error(err);toast(err.message==='קובץ גיבוי לא מתאים'||err.message.includes('שגויים')||err.message.includes('כפולים')||err.message.includes('גדול מדי')?err.message:'לא ניתן לקרוא את קובץ הגיבוי');}}

  function bind() {
    document.querySelectorAll('.tab').forEach(el=>el.addEventListener('click',()=>nav(el.dataset.tab)));
    document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>hideDialog(el.dataset.close)));
    document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
    $('help-button').onclick=()=>showDialog('help-dialog'); $('new-worker').onclick=()=>openWorker(); $('new-assignment').onclick=()=>state.workers.filter(w=>w.active!==false).length?openAssignment(): (nav('workers'),openWorker());
    $('worker-form').addEventListener('submit',saveWorker);$('assignment-form').addEventListener('submit',saveAssignment);
    $('worker-photo').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{state.photoDraft=await makeSmallPhoto(file);renderPhotoPreview();}catch(err){console.error(err);toast('לא ניתן לטעון את התמונה. נסה תמונה אחרת.');}});
    $('remove-worker-photo').onclick=()=>{state.photoDraft=null;$('worker-photo').value='';renderPhotoPreview();};
    $('daily-date').addEventListener('change',e=>{if(isoDate(e.target.value)){state.currentDate=e.target.value;renderAll();}});
    $('previous-day').onclick=()=>{state.currentDate=addDays(state.currentDate,-1);renderAll();};$('next-day').onclick=()=>{state.currentDate=addDays(state.currentDate,1);renderAll();};$('go-today').onclick=()=>{state.currentDate=localISO(new Date());renderAll();};
    $('copy-previous').onclick=copyPrevious;
    $('add-work-item').onclick=()=>appendWorkRow({},true);
    $('assignment-work-items').addEventListener('click',e=>{const btn=e.target.closest('.remove-work-item');if(!btn)return;const rows=$('assignment-work-items').querySelectorAll('.work-item-row');if(rows.length<=1)return;btn.closest('.work-item-row').remove();refreshWorkRowLabels();});
    $('daily-search').oninput=renderDaily;$('daily-company-filter').onchange=renderDaily;
    $('worker-search').oninput=renderWorkers;$('workers-status-filter').onchange=renderWorkers;
    $('generate-report').onclick=renderReport;$('report-from').onchange=()=>{if(state.activeTab==='reports')renderReport();};$('report-to').onchange=()=>{if(state.activeTab==='reports')renderReport();};$('report-company').onchange=renderReport;
    $('export-csv').onclick=exportCSV;$('export-backup').onclick=exportBackup;$('import-backup').onclick=()=>$('backup-file').click();$('backup-file').onchange=async e=>{const f=e.target.files?.[0];if(f)await importBackup(f);e.target.value='';};
    document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return; if(el.id==='empty-new-worker')openWorker();if(el.id==='empty-new-assignment')openAssignment();if(el.id==='print-report')window.print();if(el.dataset.historyWorker)openHistory(el.dataset.historyWorker);if(el.dataset.historyDate){state.currentDate=el.dataset.historyDate;hideDialog('history-dialog');nav('daily');}if(el.dataset.editWorker)openWorker(el.dataset.editWorker);if(el.dataset.assignWorker){const w=workerById(el.dataset.assignWorker);if(w?.active===false){toast('יש להפוך את הפועל לפעיל כדי לשבץ אותו');return;}nav('daily');openAssignment(null,el.dataset.assignWorker);}if(el.dataset.addWorkAssignment)openAssignment(el.dataset.addWorkAssignment,null,true);if(el.dataset.editAssignment)openAssignment(el.dataset.editAssignment);if(el.dataset.deleteAssignment)deleteAssignment(el.dataset.deleteAssignment);});
    const onlineStatus=()=>{$('offline-indicator').classList.toggle('offline',!navigator.onLine);$('offline-indicator').title=navigator.onLine?'מחובר לרשת':'לא מחובר לרשת – האפליקציה עובדת גם ללא אינטרנט לאחר התקנה';};window.addEventListener('online',onlineStatus);window.addEventListener('offline',onlineStatus);onlineStatus();
  }
  async function init() {const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1);$('report-from').value=localISO(monthStart);$('report-to').value=localISO(now);$('daily-date').value=state.currentDate;try{db=await openDB();await load();bind();renderAll();if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(console.warn);}catch(e){console.error(e);document.querySelector('.main-content').innerHTML='<div class="empty-state"><h2>לא ניתן לפתוח את מסד הנתונים</h2><p>בדוק שהגלישה אינה במצב פרטי ושהדפדפן מאפשר שמירת נתונים מקומית.</p></div>';}}
  init();
})();
