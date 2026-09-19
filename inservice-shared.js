/* Staff Training & In-Service Compliance — shared runtime for the inservice-*
 * pages.
 *
 * A FORK, not a shared original. Nothing that exists imports this file, and no
 * existing file was edited to produce it. Delete every inservice-* file and the
 * app is exactly what it is today.
 *
 * Patterns are taken from the app, not invented:
 *   - supabase.createClient with the same public URL + anon key as index.html,
 *     so the session already in localStorage on this origin is picked up. That
 *     is what makes these pages authenticated without one line changing in
 *     index.html.
 *   - sb.from(...).select(...) for every read. No state library, no fetch
 *     wrapper of its own, no framework.
 *   - esc() before interpolating anything into innerHTML, same signature and
 *     same escape set as index.html.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE, both from the module's domain spec:
 *
 * 1. Compliance is NEVER computed here. The hour arithmetic is nested —
 *    dementia hours count inside the 40- and 20-hour totals rather than on top
 *    of them — and it is already correct in training_bucket_status. This file
 *    reads status / is_overdue / urgency and renders them. It sorts by urgency
 *    and it counts rows the view has already flagged; it does not add up hours.
 *
 * 2. status and is_overdue are two separate axes and both are always rendered.
 *    A bucket that is short_on_topic AND is_overdue is the common real case,
 *    and showing one of those hides the other.
 */
const SUPABASE_URL = 'https://nwlhsshvqmbhemhxcran.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53bGhzc2h2cW1iaGVtaHhjcmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTEzOTIsImV4cCI6MjA5NTU2NzM5Mn0.2yASMx57IUNjEW8bMs8FwXnIz4cLsE1ftqD35QAOqE8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false,flowType:'implicit'}
});

// Which facility the module is looking at. index.html keeps currentFacility in
// memory only and persists nothing, so it cannot be read across a page load.
// This is the module's own per-browser choice, defaulted the same way
// index.html defaults: first facility by name.
const TC_FAC_KEY = 'title22_training_facility_id';

const tc = {user:null, role:'readonly', facilities:[], facility:null, trainingFacility:null};

// Mirrors index.html's role resolution (the owner of the facilities row is its
// administrator; everyone else carries a facility_members.role) without
// importing anything from it. Writes in this module are staff files, trainers
// and training events — administrative records — so they are held to the same
// two roles the app's own Staff tab is held to.
function tcCanEdit(){return tc.role==='administrator'||tc.role==='supervisor';}
function tcDenyEdit(){tcToast('Only an administrator or supervisor can change training records.');}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ===== PHI line =====
// Copied from index.html's T22_PHI_RULES unchanged. IDENTIFIERS ONLY, and
// deliberately no name detection: the first version of that guard matched two
// capitalised words in a row, which caught "Fire Drill" — a Title 22 term on a
// Title 22 app — as readily as a resident's name. Dates are not matched either.
// Do not add name detection here without a corpus showing zero false positives
// on real training descriptions.
const TC_PHI_RULES = [
  {kind:'a Social Security number', re:/\b\d{3}-\d{2}-\d{4}\b/},
  {kind:'an email address',         re:/\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/},
  {kind:'a phone number',           re:/\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/},
  {kind:'a date of birth',          re:/\b(d\.?o\.?b\.?|date of birth|born on|birthdate)\b/i},
  {kind:'a medical record number',  re:/\b(mrn|medical record (number|no\.?|#))\b/i},
  {kind:'an insurance or Medicare number',
                                    re:/\b(medicare|medi-?cal|insurance)\s*(id|no\.?|number|#)\b/i},
];
function tcPhiScan(text){
  const t=String(text||'');
  if(!t.trim())return [];
  const found=[];
  for(const r of TC_PHI_RULES){const m=t.match(r.re);if(m)found.push(r.kind+' ("'+m[0].trim()+'")');}
  return found;
}
// '' when clean. This module holds employee records only, so unlike the app's
// t22PhiBlock there is no showMAR escape hatch — a classroom account does not
// make a resident identifier acceptable in a training curriculum description.
function tcPhiBlock(fields){
  const reasons=[];
  for(const [label,value] of fields){for(const r of tcPhiScan(value))reasons.push(label+' contains '+r);}
  if(!reasons.length)return '';
  return 'This cannot be saved as written. This module records employee '+
    'training only — it holds no resident information, which is what keeps it '+
    'out of HIPAA business-associate territory.\n\n'+reasons.join('\n')+
    '\n\nDescribe the curriculum, not a person: "recognising and de-escalating '+
    'sundowning behaviour", not an account of one resident\'s incident.';
}

let tcToastTimer=null;
function tcToast(msg){
  let el=document.getElementById('toast');
  if(!el){el=document.createElement('div');el.id='toast';document.body.appendChild(el);}
  el.textContent=msg;el.style.display='block';
  clearTimeout(tcToastTimer);
  tcToastTimer=setTimeout(()=>{el.style.display='none'},6000);
}

// ===== formatting =====
function tcDate(v){
  if(!v)return '—';
  // A bare date column is a calendar date, not an instant. Parsing 'YYYY-MM-DD'
  // through Date() treats it as UTC midnight and shows the previous day west of
  // Greenwich, which on a compliance deadline is a real wrong answer.
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString();
  const d=new Date(v);
  return isNaN(d)?'—':d.toLocaleDateString();
}
function tcDateTime(v){if(!v)return '—';const d=new Date(v);return isNaN(d)?'—':d.toLocaleString();}
function tcHours(n){
  if(n===null||n===undefined||n==='')return '—';
  const x=Number(n);
  if(!isFinite(x))return '—';
  return (Math.round(x*100)/100).toString();
}
function tcToday(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}

const TC_ROLE_LABELS = {direct_care:'Direct care',cna:'CNA',lvn:'LVN',rn:'RN',supervisor:'Supervisor',administrator:'Administrator',support:'Support'};
function tcRole(r){return TC_ROLE_LABELS[r]||r||'—';}

// training_event.topics. resident_characteristics and postural_hospice are
// TRAINING SUBJECTS required by HSC 1569.625 — the characteristics of the
// population served, and postural support / hospice care. They are not resident
// data and nothing here stores a resident.
const TC_TOPIC_LABELS = {
  dementia:'Dementia care',
  postural_hospice:'Postural supports / hospice',
  hands_on:'Hands-on',
  shadowing:'Shadowing',
  medication:'Medication',
  resident_characteristics:"Characteristics of the population served",
};
function tcTopic(t){return TC_TOPIC_LABELS[t]||t||'';}

// ===== the two axes =====
// status says WHAT IS MISSING. is_overdue says HOW URGENT. Rendered separately,
// always, by tcStatusCell.
const TC_STATUS_META = {
  complete:        {label:'Complete',                cls:'badge-green'},
  short_on_topic:  {label:'Short on a topic minimum',cls:'badge-amber'},
  in_progress:     {label:'In progress',             cls:'badge-teal'},
  not_started:     {label:'Not started',             cls:'badge-gray'},
  needs_hire_date: {label:'Needs hire date',         cls:'badge-red'},
  needs_exam_date: {label:'Needs examination date',  cls:'badge-red'},
};
function tcStatusBadge(status){
  const m=TC_STATUS_META[status]||{label:status||'Unknown',cls:'badge-gray'};
  return `<span class="badge ${m.cls}">${esc(m.label)}</span>`;
}
// The overdue badge is its own element, never folded into the status badge.
// A complete bucket is never overdue even when it was finished late — that is
// an invariant of the view, so is_overdue is rendered exactly as it arrives.
function tcOverdueBadge(row){
  if(!row.is_overdue)return '';
  const d=row.days_until_due;
  const by=(d===null||d===undefined||!isFinite(Number(d)))?'':' by '+Math.abs(Number(d))+'d';
  return `<span class="badge badge-overdue">Overdue${esc(by)}</span>`;
}
function tcDueBadge(row){
  if(row.is_overdue)return '';
  const d=Number(row.days_until_due);
  if(!isFinite(d)||row.status==='complete')return '';
  if(d<=30)return `<span class="badge badge-amber">Due in ${d}d</span>`;
  return '';
}
function tcStatusCell(row){
  return `<div class="badgerow">${tcStatusBadge(row.status)}${tcOverdueBadge(row)}${tcDueBadge(row)}${row.is_gate?'<span class="badge badge-gray" title="Blocks working independently">Gate</span>':''}</div>`;
}
// urgency is an integer sort key, lower is more urgent. Every list in the
// module sorts on it ascending rather than on an ordering invented here.
function tcByUrgency(a,b){
  const ua=Number(a.urgency), ub=Number(b.urgency);
  const na=!isFinite(ua), nb=!isFinite(ub);
  if(na&&nb)return 0;
  if(na)return 1;
  if(nb)return -1;
  return ua-ub;
}

// ===== defensive column resolvers =====
// The views' exact column lists are not documented beyond the fields the spec
// names, so every read is select('*') and the identifying columns are resolved
// by trying the plausible spellings. Guessing one name and hard-coding it is
// how a screen silently renders "undefined" for every row.
function tcBucketCode(row){return row.template_code??row.bucket_code??row.code??null;}
function tcStaffId(row){return row.staff_id??row.training_staff_id??row.id??null;}
function tcBucketLabel(row,tmap){const c=tcBucketCode(row);return row.label??(tmap&&tmap[c]&&tmap[c].label)??c??'—';}
function tcBucketAuthority(row,tmap){const c=tcBucketCode(row);return row.authority??(tmap&&tmap[c]&&tmap[c].authority)??'';}
function tcRowName(row){return row.full_name??row.name??'';}

// ===== schema preflight =====
// This is order-of-work steps 0 and 1, performed by the product at runtime
// instead of by hand in a SQL console — because the direct lesson of
// public.users and public.launch_checklist in this repo is that code which
// assumes a migration has run fails silently for days. A missing relation here
// says which relation, on the page, in front of whoever opened it.
const TC_RELATIONS = [
  'training_facility','training_staff','training_staff_assignment','training_trainer',
  'training_requirement_template','training_requirement_submin','training_event',
  'training_attendance','training_bucket_status','training_gate_blocked','training_needs_hire_date',
];
function tcMissingRelation(error){
  if(!error)return false;
  const c=String(error.code||'');
  return c==='PGRST205'||c==='42P01'||/does not exist|could not find the table|schema cache/i.test(String(error.message||''));
}
async function tcPreflight(){
  const problems=[];
  const results=await Promise.all(TC_RELATIONS.map(async r=>{
    const {error}=await sb.from(r).select('*').limit(1);
    return {r,error};
  }));
  results.forEach(({r,error})=>{ if(tcMissingRelation(error))problems.push({kind:'relation',name:r}); });
  // is_overdue specifically: the spec says stop if the view lacks it, because
  // every screen in the module renders urgency off that column.
  if(!problems.some(p=>p.name==='training_bucket_status')){
    const {error}=await sb.from('training_bucket_status').select('status,is_overdue,urgency,hours_required,hours_completed').limit(1);
    if(error&&String(error.code||'')==='42703')problems.push({kind:'column',name:'training_bucket_status.is_overdue / urgency / hours_*'});
    else if(error&&/column .* does not exist/i.test(String(error.message||'')))problems.push({kind:'column',name:'training_bucket_status: '+error.message});
  }
  return problems;
}
function tcPreflightHTML(problems){
  const rel=problems.filter(p=>p.kind==='relation').map(p=>p.name);
  const col=problems.filter(p=>p.kind==='column').map(p=>p.name);
  return `<div class="banner banner-red">
    <div class="banner-title">The training schema is not ready — nothing below would be trustworthy</div>
    <p>This module reads its compliance arithmetic out of database views. The following are not reachable from this project, so the screens are refusing to render rather than showing zeros that look like answers.</p>
    ${rel.length?`<p style="margin-top:8px"><strong>Missing or unreadable:</strong> ${rel.map(esc).join(', ')}</p>`:''}
    ${col.length?`<p style="margin-top:8px"><strong>Missing columns:</strong> ${col.map(esc).join('; ')}</p>`:''}
    <p style="margin-top:8px">Apply the training migrations (001–006), then reload. Confirm with
    <code>select * from training_bucket_status limit 1;</code> — it must succeed and include an <code>is_overdue</code> column.</p>
  </div>`;
}

// ===== boot =====
function tcChrome(page){
  // Only pages that exist are linked. A nav entry pointing at a page that has
  // not been built yet is a 404 with the owner's name on it.
  const nav=[
    {href:'/inservice-staff.html',    key:'staff',    label:'Staff & requirements'},
    {href:'/inservice-trainers.html', key:'trainers', label:'Trainers'},
    {href:'/inservice-log.html',      key:'log',      label:'Log a session'},
  ];
  return `<header class="top">
    <div class="top-inner">
      <div>
        <a class="logo" href="/"><span class="logo-icon">T</span>Title22</a>
        <div class="eyebrow" style="margin-top:3px">Staff training &amp; in-service compliance</div>
      </div>
      <div style="text-align:right">
        <div id="tc-fac" class="fac-line"></div>
        <div id="tc-facpick" style="margin-top:6px"></div>
      </div>
    </div>
  </header>
  <nav class="modnav">${nav.map(n=>`<a href="${n.href}"${n.key===page?' aria-current="page"':''}>${esc(n.label)}</a>`).join('')}</nav>`;
}

function tcSignedOutHTML(){
  return `<div class="banner banner-gray">
    <div class="banner-title">Please sign in</div>
    <p>This is part of Title22 and reads your facility's records. <a href="/">Open Title22 and sign in</a>, then come back to this page.</p>
  </div>`;
}

// Resolves the signed-in user, their facilities and the training_facility row
// that mirrors the selected one. Returns {ok:false, html} with a rendered
// explanation for every way this can fail, so no caller has to invent wording.
async function tcBootstrap(page){
  document.body.insertAdjacentHTML('afterbegin',tcChrome(page));
  const {data:sess}=await sb.auth.getSession();
  if(!sess||!sess.session){return {ok:false,html:tcSignedOutHTML()};}
  tc.user=sess.session.user;

  const problems=await tcPreflight();
  if(problems.length)return {ok:false,html:tcPreflightHTML(problems)};

  // Same two reads, and the same merge, as index.html's loadAppInner.
  const [owned,member]=await Promise.all([
    sb.from('facilities').select('*').eq('user_id',tc.user.id).order('name'),
    sb.from('facility_members').select('facility_id, facilities(*)').eq('user_id',tc.user.id),
  ]);
  // "Could not reach the database" and "you have no facility" need different
  // words in front of someone. Reporting the second for the first is how an
  // outage gets mistaken for a data problem.
  if(owned.error&&member.error){
    return {ok:false,html:`<div class="banner banner-red"><div class="banner-title">Could not reach your facility records</div><p>${esc(owned.error.message||'')}</p><p style="margin-top:8px">This is a connection or policy failure, not an empty account. Reload once; if it persists, check that you are still signed in.</p></div>`};
  }
  const map={};
  (owned.data||[]).forEach(f=>{map[f.id]=f;});
  (member.data||[]).map(m=>m.facilities).filter(Boolean).forEach(f=>{map[f.id]=f;});
  tc.facilities=Object.values(map).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  if(!tc.facilities.length){
    return {ok:false,html:`<div class="banner banner-gray"><div class="banner-title">No facility yet</div><p>This module works against a licensed facility. <a href="/">Finish setting one up in Title22</a> first.</p></div>`};
  }
  let want=null;
  try{want=localStorage.getItem(TC_FAC_KEY);}catch(e){}
  tc.facility=tc.facilities.find(f=>f.id===want)||tc.facilities[0];

  if(tc.facility.user_id===tc.user.id){tc.role='administrator';}
  else{
    try{
      const {data:m}=await sb.from('facility_members').select('role').eq('facility_id',tc.facility.id).eq('user_id',tc.user.id).maybeSingle();
      tc.role=(m&&m.role)||'readonly';
    }catch(e){tc.role='readonly';}   // fail closed
  }

  const {data:tf}=await sb.from('training_facility').select('*').eq('external_facility_id',tc.facility.id).limit(1);
  tc.trainingFacility=(tf&&tf[0])||null;

  const fac=document.getElementById('tc-fac');
  if(fac)fac.innerHTML=esc(tc.facility.name||'Facility')+(tc.trainingFacility?.license_number?' · Lic '+esc(tc.trainingFacility.license_number):'');
  if(tc.facilities.length>1){
    const pick=document.getElementById('tc-facpick');
    if(pick)pick.innerHTML=`<select onchange="tcSwitchFacility(this.value)" style="font-size:12px;padding:5px 8px;max-width:230px">${tc.facilities.map(f=>`<option value="${esc(f.id)}"${f.id===tc.facility.id?' selected':''}>${esc(f.name||'Facility')}</option>`).join('')}</select>`;
  }

  if(!tc.trainingFacility){
    const capRaw=tc.facility.capacity;
    const cap=capRaw!==null&&capRaw!==undefined&&Number(capRaw)>0;
    return {ok:false,html:`<div class="banner banner-amber">
      <div class="banner-title">${esc(tc.facility.name||'This facility')} is not enrolled in the training module</div>
      <p>There is no <code>training_facility</code> row whose <code>external_facility_id</code> is this facility, so there is nothing for these screens to report on.</p>
      ${cap?`<p style="margin-top:8px">Enrolment has been run. Re-run <code>select * from training_link_existing_facilities();</code> to pick this facility up.</p>`
           :`<p style="margin-top:8px"><strong>This facility has no capacity set — that is why it was skipped.</strong> Enrolment reads <code>facilities.capacity</code> into <code>licensed_capacity</code>, and that is what decides the small (≤15) or large (≥16) size band. The band selects which requirements apply, so a guessed capacity would quietly put your staff on the wrong medication-training track — it is left out on purpose rather than defaulted.</p>
             <p style="margin-top:8px">Set a capacity on this facility in Title22 (Facility → Edit), then re-run <code>select * from training_link_existing_facilities();</code> once in the Supabase SQL editor.</p>`}
      <p class="hint" style="margin-top:8px">No button for it here on purpose: that function links <em>every</em> facility in the project, which is the owner's call, not a side effect of opening a page.</p>
    </div>`};
  }
  return {ok:true};
}
function tcSwitchFacility(id){
  try{localStorage.setItem(TC_FAC_KEY,id);}catch(e){}
  location.reload();
}

// Staff currently assigned to the open facility. Every view read is scoped by
// the ids this returns, because the views are documented per staff member and
// may carry no facility column of their own.
async function tcFacilityStaff(opts){
  const today=tcToday();
  const {data:asg,error}=await sb.from('training_staff_assignment').select('*').eq('facility_id',tc.trainingFacility.id);
  if(error)return {error};
  const current=(asg||[]).filter(a=>!a.effective_to||String(a.effective_to)>=today);
  const ids=[...new Set(current.map(a=>a.staff_id).filter(Boolean))];
  if(!ids.length)return {ids:[],staff:[]};
  const {data:staff,error:e2}=await sb.from('training_staff').select('*').in('id',ids).order('full_name');
  if(e2)return {error:e2};
  let rows=staff||[];
  if(opts&&opts.activeOnly)rows=rows.filter(s=>!s.terminated_at);
  return {ids:rows.map(s=>s.id),staff:rows,assignedCount:ids.length};
}

// The runtime form of order-of-work step 1. An empty result from a policy that
// returns false is indistinguishable from a facility with no staff, so when the
// facility IS enrolled and still reports nobody, say which of the two it is.
function tcNoStaffHTML(){
  return `<div class="banner banner-amber">
    <div class="banner-title">No staff are assigned to this facility in the training module</div>
    <p>Either no <code>training_staff_assignment</code> rows point at <code>training_facility.id = ${esc(tc.trainingFacility.id)}</code>, or RLS is refusing them. Those look identical from here — both return zero rows.</p>
    <p style="margin-top:8px">Check <code>training_can_access_facility('${esc(tc.trainingFacility.id)}')</code> returns true for your user. While it returns false every query in this module reads empty and the screens look broken when the policy is what is wrong.</p>
  </div>`;
}

// training_requirement_template is reference data: read only, never written.
// Cached per page load so a bucket label costs one query, not one per row.
async function tcTemplates(){
  const {data}=await sb.from('training_requirement_template').select('*');
  const map={};
  (data||[]).forEach(t=>{map[t.code]=t;});
  return map;
}
async function tcSubmins(){
  const {data}=await sb.from('training_requirement_submin').select('*');
  const by={};
  (data||[]).forEach(s=>{(by[s.template_code]=by[s.template_code]||[]).push(s);});
  return by;
}
