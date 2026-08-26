import {useEffect,useMemo,useState} from 'react'
import {CalendarDays,ExternalLink,FileUp,Info,Lightbulb} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api,getError,apiFileUrl} from '../lib/api'
import FileUpload from '../components/FileUpload'
import {Card,ErrorBox,Loader,Modal,PageHeader,Status,Tooltip} from '../components/UI'
import {assignmentDepartment,assignmentMonth,compareText} from '../lib/sorting'

function monthYearLabel(item){
  const value=item?.month||assignmentMonth(item)
  const date=value&&/^\d{4}-\d{2}/.test(value)?new Date(`${value.slice(0,10)}T00:00:00`):null
  return date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(date):(item?.cycle||value||'Unknown month')
}

function Input({item,value,onChange,disabled}){
  const r=value||{},cfg=item.config||{},map=cfg.score_map||{}
  if(['choice','yesno'].includes(item.input_type)) return <select disabled={disabled} value={r.selected_option||''} onChange={e=>onChange({...r,selected_option:e.target.value})}><option value="">Select an answer...</option>{Object.keys(map).map(o=><option key={o} value={o}>{o} ({map[o]}%)</option>)}</select>
  if(item.input_type==='rating') return <input disabled={disabled} type="number" min="1" max={cfg.max_rating||5} value={r.actual_numeric??''} onChange={e=>onChange({...r,actual_numeric:e.target.value===''?null:Number(e.target.value)})}/>
  return <input disabled={disabled} type="number" step="0.01" value={r.actual_numeric??''} onChange={e=>onChange({...r,actual_numeric:e.target.value===''?null:Number(e.target.value)})} placeholder={item.target_value!=null?`Enter achievement (target ${item.target_value})`:'Enter actual achievement'}/>
}

export default function KpiInput(){
  const [params,setParams]=useSearchParams(),[list,setList]=useState(null),[assignment,setAssignment]=useState(null),[values,setValues]=useState({}),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [showImporter,setShowImporter]=useState(false),[importPreview,setImportPreview]=useState(null),[importBusy,setImportBusy]=useState(false)
  const [selectedDepartment,setSelectedDepartment]=useState(''),[selectedPerson,setSelectedPerson]=useState('')
  const today=new Date()
  const [showCalendar,setShowCalendar]=useState(false),[calendarYear,setCalendarYear]=useState(today.getFullYear()),[calendarMonth,setCalendarMonth]=useState(today.getMonth()),[calendarDay,setCalendarDay]=useState(1),[calendarError,setCalendarError]=useState('')
  const [showGuide,setShowGuide]=useState(()=>localStorage.getItem('kpi_guide_dismissed')!=='1')
  const id=params.get('assignment')
  const loadList=()=>api.get('/kpi/my').then(r=>{setList(r.data);if(!id&&r.data[0])setParams({assignment:r.data[0].id})}).catch(e=>setError(getError(e)))
  useEffect(()=>{loadList()},[])
  useEffect(()=>{if(params.get('guide')==='1')setShowGuide(true)},[params])
  async function loadAssignment(){if(!id)return;setAssignment(null);setValues({});try{const {data}=await api.get(`/kpi/assignments/${id}`);setAssignment(data);const map={};data.template.kras.forEach(k=>k.items.forEach(i=>{map[i.id]={kpi_item_id:i.id,...(i.response||{})}}));setValues(map)}catch(e){setError(getError(e))}}
  useEffect(()=>{loadAssignment()},[id])

  const locked=assignment&&['submitted','manager_reviewed','finalized'].includes(assignment.status)
  const allItems=useMemo(()=>assignment?assignment.template.kras.flatMap(k=>k.items):[],[assignment])
  const byId=useMemo(()=>Object.fromEntries(allItems.map(x=>[x.id,x])),[allItems])
  const isAnswered=i=>{const v=values[i.id]||{};return ['choice','yesno'].includes(i.input_type)?!!v.selected_option:v.actual_numeric!==null&&v.actual_numeric!==undefined&&v.actual_numeric!==''}
  const answered=allItems.filter(isAnswered).length,completion=allItems.length?Math.round(answered/allItems.length*100):0
  const hasEvidence=v=>Boolean(v?.evidence_file_id)
  const missingEvidence=allItems.filter(i=>i.config?.meta?.evidence_required&&isAnswered(i)&&!hasEvidence(values[i.id]))
  const groupedAssignments=useMemo(()=>{
    const sorted=[...(list||[])].sort((a,b)=>compareText(assignmentDepartment(a),assignmentDepartment(b))||compareText(assignmentMonth(b),assignmentMonth(a))||compareText(a.employee,b.employee)||compareText(a.template?.name,b.template?.name))
    return sorted.reduce((groups,a)=>{
      const label=`${assignmentDepartment(a)} · ${a.cycle || 'No month'}`
      const group=groups.find(x=>x.label===label)
      if(group) group.items.push(a)
      else groups.push({label,items:[a]})
      return groups
    },[])
  },[list])

  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment))].sort(compareText),[list])
  const departmentAssignments=useMemo(()=> (list||[]).filter(a=>assignmentDepartment(a)===selectedDepartment),[list,selectedDepartment])
  const people=useMemo(()=>{const seen=new Map();departmentAssignments.forEach(a=>{const key=`${a.employee}::${a.designation||a.template?.name||''}`;if(!seen.has(key))seen.set(key,{key,name:a.employee,designation:a.designation||a.template?.name||''})});return [...seen.values()].sort((a,b)=>compareText(a.name,b.name))},[departmentAssignments])
  const personAssignments=useMemo(()=>departmentAssignments.filter(a=>`${a.employee}::${a.designation||a.template?.name||''}`===selectedPerson).sort((a,b)=>String(b.month||assignmentMonth(b)).localeCompare(String(a.month||assignmentMonth(a))||String(b.id).localeCompare(String(a.id)))),[departmentAssignments,selectedPerson])
  const selectedSummary=list?.find(a=>String(a.id)===String(id))
  useEffect(()=>{if(!list?.length)return;const current=selectedSummary||list[0];setSelectedDepartment(assignmentDepartment(current));setSelectedPerson(`${current.employee}::${current.designation||current.template?.name||''}`);if(!id)setParams({assignment:current.id})},[list,id])
  useEffect(()=>{if(selectedDepartment&&!people.some(p=>p.key===selectedPerson)){const first=people[0];if(first){setSelectedPerson(first.key);const firstAssignment=departmentAssignments.find(a=>`${a.employee}::${a.designation||a.template?.name||''}`===first.key);if(firstAssignment)setParams({assignment:firstAssignment.id})}}},[selectedDepartment,people,selectedPerson,departmentAssignments])
  function selectDepartment(value){setSelectedDepartment(value);const first=(list||[]).filter(a=>assignmentDepartment(a)===value).sort((a,b)=>compareText(a.employee,b.employee))[0];if(first){setSelectedPerson(`${first.employee}::${first.designation||first.template?.name||''}`);setParams({assignment:first.id})}}
  function selectPerson(value){setSelectedPerson(value);const first=departmentAssignments.find(a=>`${a.employee}::${a.designation||a.template?.name||''}`===value);if(first)setParams({assignment:first.id})}
  function selectMonth(value){if(value)setParams({assignment:value})}
  const calendarYears=useMemo(()=>{const years=personAssignments.map(a=>Number(String(a.month||'').slice(0,4))).filter(Boolean);const min=Math.min(today.getFullYear(),...(years.length?years:[today.getFullYear()]));const max=Math.max(today.getFullYear()+1,...years);return Array.from({length:max-min+1},(_,i)=>min+i)},[personAssignments])
  const calendarDays=useMemo(()=>Array.from({length:new Date(calendarYear,calendarMonth+1,0).getDate()},(_,i)=>i+1),[calendarYear,calendarMonth])
  function openCalendar(){const current=selectedSummary?.month||today.toISOString().slice(0,10);const date=/^\d{4}-\d{2}/.test(current)?new Date(`${current.slice(0,10)}T00:00:00`):today;setCalendarYear(date.getFullYear());setCalendarMonth(date.getMonth());setCalendarDay(date.getDate());setCalendarError('');setShowCalendar(true)}
  function applyCalendar(){const assignmentForDate=personAssignments.find(a=>{const value=String(a.month||'');return Number(value.slice(0,4))===calendarYear&&Number(value.slice(5,7))-1===calendarMonth});if(!assignmentForDate){setCalendarError('No Fill KPI assignment exists for this person in the selected month. Create or assign the KPI first.');return}setParams({assignment:assignmentForDate.id});setShowCalendar(false)}

  function setValue(itemId,patch){const nextPatch=patch.remarks!==undefined?{...patch,measurement:patch.remarks}:patch;setValues(current=>({...current,[itemId]:{...current[itemId],...nextPatch,kpi_item_id:itemId}}))}

  async function save(){setError('');setMessage('');try{const payload=allItems.map(i=>({kpi_item_id:i.id,actual_numeric:values[i.id]?.actual_numeric??null,answer_text:values[i.id]?.answer_text??null,selected_option:values[i.id]?.selected_option??null,measurement:values[i.id]?.measurement??null,remarks:values[i.id]?.remarks??null,evidence_url:null,evidence_file_id:values[i.id]?.evidence_file_id??null}));const {data}=await api.put(`/kpi/assignments/${id}/responses`,payload);setMessage(`Draft saved. Current calculated score: ${data.score}/100`);await loadAssignment();return true}catch(e){setError(getError(e));return false}}
  async function submit(){if(answered!==allItems.length){setError(`Complete every KPI parameter before submitting (${answered}/${allItems.length} answered).`);return}if(missingEvidence.length){setError(`Attach evidence for ${missingEvidence.length} required KPI parameter(s) before submission.`);return}const ok=await save();if(!ok)return;try{const {data}=await api.post(`/kpi/assignments/${id}/submit`);setMessage(`Submitted successfully. Calculated score: ${data.score}/100. Your form is now locked for review.`);await loadAssignment();loadList()}catch(e){setError(getError(e))}}

  async function parseImport(fileMeta){
    if(!fileMeta||!id)return
    setImportBusy(true);setError('')
    try{const fd=new FormData();fd.append('file_id',fileMeta.file_id);fd.append('assignment_id',id);const {data}=await api.post('/files/parse-kpi-excel',fd,{headers:{'Content-Type':'multipart/form-data'}});setImportPreview(data)}catch(e){setError(getError(e))}finally{setImportBusy(false)}
  }
  function applyImport(){
    if(!importPreview)return
    setValues(current=>{const next={...current};for(const row of importPreview.rows){if(!row.matched||!row.kpi_item_id)continue;const item=byId[row.kpi_item_id];if(!item)continue;next[item.id]={...next[item.id],kpi_item_id:item.id,remarks:row.remarks||next[item.id]?.remarks||''};if(['choice','yesno'].includes(item.input_type))next[item.id].selected_option=row.selected_option||next[item.id]?.selected_option||'';else if(row.actual_numeric!==null&&row.actual_numeric!==undefined)next[item.id].actual_numeric=row.actual_numeric}return next});setShowImporter(false);setImportPreview(null);setMessage('Imported values applied. Review them, upload PDF evidence where needed, then save or submit.')
  }
  function dismissGuide(){localStorage.setItem('kpi_guide_dismissed','1');setShowGuide(false)}

  return <>
    <PageHeader title="KPI Input" subtitle="Choose a department, person and month, then update the actual achievement." actions={<button className="secondary" disabled={!id||locked} onClick={()=>setShowImporter(true)}><FileUp size={16}/>Import</button>}/>
    <div className="kpi-selector-bar"><div><strong>1. Department</strong><select aria-label="Department" value={selectedDepartment} onChange={e=>selectDepartment(e.target.value)}><option value="">Choose department</option>{departments.map(d=><option value={d} key={d}>{d}</option>)}</select></div><div><strong>2. Person</strong><select aria-label="Person" value={selectedPerson} onChange={e=>selectPerson(e.target.value)} disabled={!selectedDepartment}><option value="">Choose person</option>{people.map(p=><option value={p.key} key={p.key}>{p.name} · {p.designation}</option>)}</select></div><div><strong>3. Month and year</strong><select aria-label="Month and year" value={id||''} onChange={e=>selectMonth(e.target.value)} disabled={!selectedPerson}><option value="">Choose month and year</option>{personAssignments.map(a=><option value={a.id} key={a.id}>{monthYearLabel(a)}</option>)}</select>{selectedPerson&&!personAssignments.length?<span className="selector-help">No Fill KPI assignment exists for this person yet.</span>:null}</div></div>
    <div className="calendar-open-row"><button type="button" className="calendar-trigger" onClick={openCalendar} disabled={!selectedPerson}><CalendarDays size={16}/>{selectedSummary?monthYearLabel(selectedSummary):'Choose month and year'}</button><span className="selector-help">Select year, month and date, then apply.</span></div>
    <div className="helper-strip">Enter the actual achievement and the measurement completed for each KPI. Weight base is shown for reference; score is calculated automatically.</div>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}
    {showGuide?<div className="onboarding-guide"><div className="guide-icon"><Lightbulb size={20}/></div><div><strong>How to complete your KPI</strong><div className="guide-steps"><span><b>1</b>Read the task</span><span><b>2</b>Enter actual achievement</span><span><b>3</b>Attach evidence if required</span><span><b>4</b>Save and submit</span></div></div><button className="secondary small" onClick={dismissGuide}>Got it</button></div>:null}
    {!assignment?<Loader/>:<>
      <div className="workflow-steps"><span className="done">1. Fill KPI</span><span className={['submitted','manager_reviewed','finalized'].includes(assignment.status)?'done':''}>2. Submit</span><span className={['manager_reviewed','finalized'].includes(assignment.status)?'done':''}>3. Manager review</span><span className={assignment.status==='finalized'?'done':''}>4. HR final</span></div>
      <div className="metric-grid compact"><Card><span>Employee</span><strong className="small-metric">{assignment.employee}</strong></Card><Card><span>Cycle</span><strong className="small-metric">{assignment.cycle}</strong></Card><Card><span>Form completion</span><strong>{completion}%</strong><div className="bar"><i style={{width:`${completion}%`}}/></div></Card><Card><span>Calculated score</span><strong>{Number(assignment.calculated_score||0).toFixed(1)}</strong><Status value={assignment.status}/></Card></div>
      <div className="stack">{assignment.template.kras.map(kra=><Card key={kra.id}><div className="kra-title"><div><h3>{kra.name}</h3><p>{kra.items.length} KPI parameters · enter the result, then add a short note and PDF if needed</p></div><div className="weight-chip">{kra.weight} marks</div></div><div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter</th><th>Measurement / target</th><th>Your result</th><th>Weight</th><th>Score</th><th>Short note & PDF evidence</th></tr></thead><tbody>{kra.items.map(item=>{const meta=item.config?.meta||{},v=values[item.id]||{};return <tr key={item.id}><td><strong>{item.question}</strong><Tooltip text={`Enter the actual result for this KPI. Input type: ${item.input_type}. ${item.direction==='lower'?'Lower values perform better.':'Higher values perform better.'}`}/><div className="cell-help">{item.input_type.replaceAll('_',' ')} · {meta.frequency||'Monthly'}</div></td><td><div className="measurement-text">{meta.measurement||'Use your actual result for the selected period.'}<div className="target-hint">Target: {item.target_value??(['choice','yesno'].includes(item.input_type)?'Choose an answer':'Configured')}</div>{meta.evidence_required?<span className="required-chip">PDF required</span>:null}</div></td><td><Input disabled={locked} item={item} value={v} onChange={patch=>setValue(item.id,patch)}/></td><td>{item.weight}</td><td><strong>{Number(item.response?.score||0).toFixed(1)}</strong><div className="cell-help">{Number(item.response?.achievement_pct||0).toFixed(0)}%</div></td><td><div className="stack-tight"><input disabled={locked} value={v.remarks||''} onChange={e=>setValue(item.id,{remarks:e.target.value})} placeholder="Short remark (optional)"/><FileUpload compact disabled={locked} accept=".pdf" help="PDF only · maximum 10 MB" label="Upload PDF evidence" value={v.evidence_file||null} onUploaded={file=>setValue(item.id,{evidence_file_id:file?.file_id||null,evidence_file:file||null})}/>{v.evidence_file?<a className="evidence-link" href={apiFileUrl(v.evidence_file)} target="_blank" rel="noreferrer"><ExternalLink size={12}/>Open {v.evidence_file.filename}</a>:null}</div></td></tr>})}</tbody></table></div></Card>)}</div>
      {!locked?<div className="footer-actions sticky-actions"><button className="secondary" onClick={save}>Save draft</button><button className="primary" onClick={submit}>Submit KPI</button></div>:<div className="locked-note">This KPI is locked after submission. Your manager verifies it, then HR finalizes the score.</div>}
    </>}

    {showImporter?<Modal title="Import KPI values from Excel or PDF" onClose={()=>{setShowImporter(false);setImportPreview(null)}} className="wide-modal" actions={importPreview?<><button className="secondary" onClick={()=>{setShowImporter(false);setImportPreview(null)}}>Cancel</button><button className="primary" disabled={!importPreview.matched} onClick={applyImport}>Apply {importPreview.matched} matched row(s)</button></>:null}><p className="muted small-copy">Use the standard columns <b>KPI Parameter | Actual Value | Remarks | Evidence File</b>. Imported values are only a preview until you apply and save them.</p>{!importPreview?<FileUpload onUploaded={parseImport} label="Choose KPI input file" help="PDF, XLSX, XLS or CSV · maximum 10 MB"/>:<><div className="import-summary"><strong>{importPreview.matched} matched</strong><span>{importPreview.unmatched} need manual review</span></div><div className="table-wrap"><table><thead><tr><th>From file</th><th>Matched KPI</th><th>Actual</th><th>Remarks</th><th>Evidence reference</th><th>Confidence</th></tr></thead><tbody>{importPreview.rows.map((r,i)=><tr key={i} className={!r.matched?'unmatched-row':''}><td>{r.kpi_parameter}</td><td>{r.matched_question||'Not matched'}</td><td>{r.actual_value||'—'}</td><td>{r.remarks||'—'}</td><td>{r.evidence_file||'—'}</td><td>{r.matched?`${r.confidence}%`:'Review manually'}</td></tr>)}</tbody></table></div></>}{importBusy?<div className="helper-strip"><Info size={14}/> Reading and matching KPI rows...</div>:null}</Modal>:null}
    {showCalendar?<Modal title="Choose Fill KPI date" onClose={()=>setShowCalendar(false)} actions={<><button className="secondary" onClick={()=>setShowCalendar(false)}>Cancel</button><button className="primary" onClick={applyCalendar}>Apply date</button></>}><div className="calendar-picker"><label>1. Choose year<select value={calendarYear} onChange={e=>setCalendarYear(Number(e.target.value))}>{calendarYears.map(year=><option value={year} key={year}>{year}</option>)}</select></label><div><strong>2. Choose month</strong><div className="calendar-months">{Array.from({length:12},(_,month)=>{const label=new Intl.DateTimeFormat(undefined,{month:'short'}).format(new Date(2020,month,1));return <button type="button" className={calendarMonth===month?'selected':''} onClick={()=>setCalendarMonth(month)} key={month}>{label}</button>})}</div></div><div><strong>3. Choose date</strong><div className="calendar-days">{calendarDays.map(day=><button type="button" className={calendarDay===day?'selected':''} onClick={()=>setCalendarDay(day)} key={day}>{day}</button>)}</div></div>{calendarError?<div className="error-box">{calendarError}</div>:null}</div></Modal>:null}
  </>
}
