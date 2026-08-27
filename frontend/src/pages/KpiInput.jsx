import {useEffect, useMemo, useState} from 'react'
import {CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, FileUp, Info, Lightbulb} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api, apiFileUrl, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import FileUpload from '../components/FileUpload'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status, Tooltip} from '../components/UI'
import {assignmentDepartment, assignmentMonth, compareText} from '../lib/sorting'

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function monthYearLabel(item){
  const value=item?.month||assignmentMonth(item)
  const date=value&&/^\d{4}-\d{2}/.test(value)?new Date(`${value.slice(0,10)}T00:00:00`):null
  return date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(date):(item?.cycle||value||'Unknown month')
}

function parseAssignmentYearMonth(a) {
  if (!a) return { year: null, monthIdx: null }
  const raw = String(a.month || a.cycle || a.created_at || '').trim()
  if (/^\d{4}-\d{2}/.test(raw)) {
    const yr = Number(raw.slice(0, 4))
    const mIdx = Number(raw.slice(5, 7)) - 1
    return { year: yr, monthIdx: mIdx }
  }
  const parts = raw.split(/[\s,-]+/)
  let yr = null
  let mIdx = null
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) yr = Number(part)
    const idx = monthNames.findIndex(m => m.toLowerCase() === part.toLowerCase().slice(0, 3))
    if (idx !== -1) mIdx = idx
  }
  if (yr !== null && mIdx !== null) return { year: yr, monthIdx: mIdx }
  if (a.created_at) {
    const d = new Date(a.created_at)
    if (!Number.isNaN(d.getTime())) return { year: d.getFullYear(), monthIdx: d.getMonth() }
  }
  return { year: null, monthIdx: null }
}

function Input({item,value,onChange,disabled}){
  const r=value||{},cfg=item.config||{},map=cfg.score_map||{}
  if(['choice','yesno'].includes(item.input_type)) return <select disabled={disabled} value={r.selected_option||''} onChange={e=>onChange({...r,selected_option:e.target.value})}><option value="">Select an answer...</option>{Object.keys(map).map(o=><option key={o} value={o}>{o} ({map[o]}%)</option>)}</select>
  if(item.input_type==='rating') return <input disabled={disabled} type="number" min="1" max={cfg.max_rating||5} value={r.actual_numeric??''} onChange={e=>onChange({...r,actual_numeric:e.target.value===''?null:Number(e.target.value)})}/>
  return <input disabled={disabled} type="number" step="0.01" value={r.actual_numeric??''} onChange={e=>onChange({...r,actual_numeric:e.target.value===''?null:Number(e.target.value)})} placeholder={item.target_value!=null?`Enter achievement (target ${item.target_value})`:'Enter actual achievement'}/>
}

export default function KpiInput(){
  const { user } = useAuth()
  const [params,setParams]=useSearchParams(),[list,setList]=useState(null),[assignment,setAssignment]=useState(null),[values,setValues]=useState({}),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [showImporter,setShowImporter]=useState(false),[importPreview,setImportPreview]=useState(null),[importBusy,setImportBusy]=useState(false)
  const [selectedDepartment,setSelectedDepartment]=useState(''),[selectedPerson,setSelectedPerson]=useState('')
  const today=new Date()
  const [showCalendar,setShowCalendar]=useState(false),[calendarYear,setCalendarYear]=useState(today.getFullYear()),[calendarMonth,setCalendarMonth]=useState(today.getMonth()),[calendarDay,setCalendarDay]=useState(today.getDate()),[calendarError,setCalendarError]=useState('')
  const [selectedDateLabel, setSelectedDateLabel] = useState('')
  const [showGuide,setShowGuide]=useState(()=>localStorage.getItem('kpi_guide_dismissed')!=='1')
  const id=params.get('assignment')

  const loadList=()=>api.get('/kpi/my').then(r=>{setList(r.data);if(!id&&r.data[0])setParams({assignment:r.data[0].id})}).catch(e=>setError(getError(e)))
  useEffect(()=>{loadList()},[])
  useEffect(()=>{if(params.get('guide')==='1')setShowGuide(true)},[params])
  
  async function loadAssignment(){
    if(!id)return
    setAssignment(null)
    setValues({})
    try{
      const {data}=await api.get(`/kpi/assignments/${id}`)
      setAssignment(data)
      const map={}
      data.template.kras.forEach(k=>k.items.forEach(i=>{map[i.id]={kpi_item_id:i.id,...(i.response||{})}}))
      setValues(map)
    }catch(e){setError(getError(e))}
  }
  useEffect(()=>{loadAssignment()},[id])

  const isAdminOrHr = ['superadmin', 'hr'].includes(user?.role)
  const isSubmitted = assignment && ['submitted', 'manager_reviewed', 'finalized'].includes(assignment.status)
  const locked = isSubmitted && !isAdminOrHr

  async function reopenAssignment() {
    if (!id || !isAdminOrHr) return
    setError(''); setMessage('')
    try {
      await api.post(`/kpi/assignments/${id}/reopen`, { reason: `Unlocked/reopened by ${user?.name || user?.role || 'Admin'} for employee editing.` })
      setMessage(`KPI assignment successfully unlocked and reopened for employee editing.`)
      await loadAssignment()
      loadList()
    } catch (e) {
      setError(getError(e))
    }
  }
  const allItems=useMemo(()=>assignment?assignment.template.kras.flatMap(k=>k.items):[],[assignment])
  const byId=useMemo(()=>Object.fromEntries(allItems.map(x=>[x.id,x])),[allItems])
  const isAnswered=i=>{const v=values[i.id]||{};return ['choice','yesno'].includes(i.input_type)?!!v.selected_option:v.actual_numeric!==null&&v.actual_numeric!==undefined&&v.actual_numeric!==''}
  const answered=allItems.filter(isAnswered).length,completion=allItems.length?Math.round(answered/allItems.length*100):0
  const hasEvidence=v=>Boolean(v?.evidence_file_id)
  const missingEvidence=allItems.filter(i=>i.config?.meta?.evidence_required&&isAnswered(i)&&!hasEvidence(values[i.id]))

  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment))].sort(compareText),[list])
  const departmentAssignments=useMemo(()=> (list||[]).filter(a=>assignmentDepartment(a)===selectedDepartment),[list,selectedDepartment])
  const people=useMemo(()=>{const seen=new Map();departmentAssignments.forEach(a=>{const key=`${a.employee}::${a.designation||a.template?.name||''}`;if(!seen.has(key))seen.set(key,{key,name:a.employee,designation:a.designation||a.template?.name||''})});return [...seen.values()].sort((a,b)=>compareText(a.name,b.name))},[departmentAssignments])
  const personAssignments=useMemo(()=>departmentAssignments.filter(a=>`${a.employee}::${a.designation||a.template?.name||''}`===selectedPerson).sort((a,b)=>String(b.month||assignmentMonth(b)).localeCompare(String(a.month||assignmentMonth(a))||String(b.id).localeCompare(String(a.id)))),[departmentAssignments,selectedPerson])
  const selectedSummary=list?.find(a=>String(a.id)===String(id))

  useEffect(()=>{if(!list?.length)return;const current=selectedSummary||list[0];setSelectedDepartment(assignmentDepartment(current));setSelectedPerson(`${current.employee}::${current.designation||current.template?.name||''}`);if(!id)setParams({assignment:current.id})},[list,id])
  useEffect(()=>{if(selectedDepartment&&!people.some(p=>p.key===selectedPerson)){const first=people[0];if(first){setSelectedPerson(first.key);const firstAssignment=departmentAssignments.find(a=>`${a.employee}::${a.designation||a.template?.name||''}`===first.key);if(firstAssignment)setParams({assignment:firstAssignment.id})}}},[selectedDepartment,people,selectedPerson,departmentAssignments])

  function selectDepartment(value){setSelectedDepartment(value);setSelectedDateLabel('');const first=(list||[]).filter(a=>assignmentDepartment(a)===value).sort((a,b)=>compareText(a.employee,b.employee))[0];if(first){setSelectedPerson(`${first.employee}::${first.designation||first.template?.name||''}`);setParams({assignment:first.id})}}
  function selectPerson(value){setSelectedPerson(value);setSelectedDateLabel('');const first=departmentAssignments.find(a=>`${a.employee}::${a.designation||a.template?.name||''}`===value);if(first)setParams({assignment:first.id})}

  const calendarDays=useMemo(()=>Array.from({length:new Date(calendarYear,calendarMonth+1,0).getDate()},(_,i)=>i+1),[calendarYear,calendarMonth])

  function openCalendar(){
    const { year, monthIdx } = parseAssignmentYearMonth(selectedSummary)
    if (year !== null && monthIdx !== null) {
      setCalendarYear(year)
      setCalendarMonth(monthIdx)
    } else {
      setCalendarYear(today.getFullYear())
      setCalendarMonth(today.getMonth())
    }
    setCalendarDay(today.getDate())
    setCalendarError('')
    setShowCalendar(true)
  }

  function applyCalendar(targetMonth = calendarMonth, targetYear = calendarYear, targetDay = null){
    setCalendarError('')
    let assignmentForDate = null
    if (selectedPerson) {
      assignmentForDate = personAssignments.find(a => {
        const { year, monthIdx } = parseAssignmentYearMonth(a)
        return year === targetYear && monthIdx === targetMonth
      })
    }
    if (!assignmentForDate && selectedDepartment) {
      assignmentForDate = departmentAssignments.find(a => {
        const { year, monthIdx } = parseAssignmentYearMonth(a)
        return year === targetYear && monthIdx === targetMonth
      })
    }
    if (!assignmentForDate) {
      assignmentForDate = (list || []).find(a => {
        const { year, monthIdx } = parseAssignmentYearMonth(a)
        return year === targetYear && monthIdx === targetMonth
      })
    }
    if (!assignmentForDate) {
      setCalendarError(`No KPI assignment found for ${monthNames[targetMonth]} ${targetYear}.`)
      return
    }
    setSelectedDepartment(assignmentDepartment(assignmentForDate))
    setSelectedPerson(`${assignmentForDate.employee}::${assignmentForDate.designation || assignmentForDate.template?.name || ''}`)
    if (targetDay) {
      setSelectedDateLabel(`${targetDay} ${monthNames[targetMonth]} ${targetYear}`)
    } else {
      setSelectedDateLabel(`${monthNames[targetMonth]} ${targetYear}`)
    }
    setParams({assignment: assignmentForDate.id})
    setShowCalendar(false)
  }

  function setValue(itemId,patch){const nextPatch=patch.remarks!==undefined?{...patch,measurement:patch.remarks}:patch;setValues(current=>({...current,[itemId]:{...current[itemId],...nextPatch,kpi_item_id:itemId}}))}

  async function save(){
    setError('');setMessage('')
    try{
      const payload=allItems.map(i=>({kpi_item_id:i.id,actual_numeric:values[i.id]?.actual_numeric??null,answer_text:values[i.id]?.answer_text??null,selected_option:values[i.id]?.selected_option??null,measurement:values[i.id]?.measurement??null,remarks:values[i.id]?.remarks??null,evidence_url:null,evidence_file_id:values[i.id]?.evidence_file_id??null}))
      const {data}=await api.put(`/kpi/assignments/${id}/responses`,payload)
      setMessage(`Draft saved. Current calculated score: ${data.score}/100`)
      await loadAssignment()
      return true
    }catch(e){setError(getError(e));return false}
  }

  async function submit(){
    if(answered!==allItems.length){setError(`Complete every KPI parameter before submitting (${answered}/${allItems.length} answered).`);return}
    if(missingEvidence.length){setError(`Attach evidence for ${missingEvidence.length} required KPI parameter(s) before submission.`);return}
    const ok=await save()
    if(!ok)return
    try{
      const {data}=await api.post(`/kpi/assignments/${id}/submit`)
      setMessage(`Submitted successfully. Calculated score: ${data.score}/100. Your form is now locked for review.`)
      await loadAssignment()
      loadList()
    }catch(e){setError(getError(e))}
  }

  const hasRegisteredData = useMemo(() => {
    if (!assignment) return false
    return allItems.some(isAnswered)
  }, [assignment, allItems, values])

  async function downloadPdfReport() {
    if (!id) return
    const label = selectedDateLabel || (selectedSummary ? monthYearLabel(selectedSummary) : assignment?.cycle || '')
    if (!hasRegisteredData) {
      setError(`No KPI input data registered for ${label}. Please enter actual achievement values before downloading.`)
      return
    }
    setError('')
    try {
      const response = await api.get(`/kpi/assignments/${id}/pdf?date_label=${encodeURIComponent(label)}`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const fileLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      a.download = `kpi_report_${(assignment?.employee || 'user').toLowerCase().replace(/\s+/g, '_')}_${fileLabel}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(getError(e))
    }
  }

  async function parseImport(fileMeta){
    if(!fileMeta||!id)return
    setImportBusy(true);setError('')
    try{
      const fd=new FormData()
      fd.append('file_id',fileMeta.file_id)
      fd.append('assignment_id',id)
      const {data}=await api.post('/files/parse-kpi-excel',fd,{headers:{'Content-Type':'multipart/form-data'}})
      setImportPreview(data)
    }catch(e){setError(getError(e))}finally{setImportBusy(false)}
  }

  function applyImport(){
    if(!importPreview)return
    setValues(current=>{
      const next={...current}
      for(const row of importPreview.rows){
        if(!row.matched||!row.kpi_item_id)continue
        const item=byId[row.kpi_item_id]
        if(!item)continue
        next[item.id]={...next[item.id],kpi_item_id:item.id,remarks:row.remarks||next[item.id]?.remarks||''}
        if(['choice','yesno'].includes(item.input_type)) next[item.id].selected_option=row.selected_option||next[item.id]?.selected_option||''
        else if(row.actual_numeric!==null&&row.actual_numeric!==undefined) next[item.id].actual_numeric=row.actual_numeric
      }
      return next
    })
    setShowImporter(false)
    setImportPreview(null)
    setMessage('Imported values applied. Review them, upload PDF evidence where needed, then save or submit.')
  }

  function dismissGuide(){localStorage.setItem('kpi_guide_dismissed','1');setShowGuide(false)}

  function downloadSampleImportFile() {
    const content = `KPI Parameter,Actual Value,Remarks,Evidence File\nJava/Spring Boot development,95%,Completed 5 microservices tasks on time,\nDefects and production bug count,0,Zero production defects this month,\nCode review and technical documentation,100%,Submitted PRs with documentation and unit tests,\nKnowledge sharing & continuous improvement,Excellent,Conducted 2 tech talk sessions,`
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'sample_kpi_input_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return <>
    <PageHeader 
      title="KPI Input" 
      subtitle="Choose a department, person and month, then update the actual achievement." 
      actions={
        <div style={{display:'flex',gap:'8px'}}>
          <button className="secondary" disabled={!id} onClick={downloadPdfReport}>
            <Download size={16}/>Export PDF Report
          </button>
        </div>
      }
    />

    <div className="kpi-selector-bar">
      <div>
        <strong>1. Department</strong>
        <select aria-label="Department" value={selectedDepartment} onChange={e=>selectDepartment(e.target.value)}>
          <option value="">Choose department</option>
          {departments.map(d=><option value={d} key={d}>{d}</option>)}
        </select>
      </div>
      <div>
        <strong>2. Person</strong>
        <select aria-label="Person" value={selectedPerson} onChange={e=>selectPerson(e.target.value)} disabled={!selectedDepartment}>
          <option value="">Choose person</option>
          {people.map(p=><option value={p.key} key={p.key}>{p.name} ({p.item?.employee_no || p.item?.employee_id || ''}) · {p.designation}</option>)}
        </select>
      </div>
      <div>
        <strong>3. Month & Date</strong>
        <button 
          type="button" 
          className="calendar-trigger" 
          onClick={openCalendar} 
          style={{
            width:'100%',
            height:'42px',
            display:'flex',
            alignItems:'center',
            justify:'space-between',
            background:'#ffffff',
            border:'1px solid #cbd5e1',
            padding:'0 12px',
            borderRadius:'8px',
            fontSize:'0.85rem',
            fontWeight:650,
            color:'#0f172a',
            cursor:'pointer',
            touchAction:'manipulation',
            boxShadow:'0 1px 2px rgba(15,23,42,0.05)'
          }}
        >
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <CalendarDays size={18} style={{color:'#2563eb'}}/>
            <span>{selectedDateLabel || (selectedSummary ? monthYearLabel(selectedSummary) : 'Choose month & date')}</span>
          </div>
          <span style={{fontSize:'0.75rem',color:'#2563eb',fontWeight:600}}>Select Month & Date</span>
        </button>
        {selectedPerson && !personAssignments.length ? (
          <span className="selector-help">No KPI assignment for this person yet.</span>
        ) : null}
      </div>
    </div>

    <div className="helper-strip">Enter the actual achievement and the measurement completed for each KPI. Weight base is shown for reference; score is calculated automatically.</div>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}

    {showGuide?<div className="onboarding-guide"><div className="guide-icon"><Lightbulb size={20}/></div><div><strong>How to complete your KPI</strong><div className="guide-steps"><span><b>1</b>Read the task</span><span><b>2</b>Enter actual achievement</span><span><b>3</b>Attach evidence if required</span><span><b>4</b>Save and submit</span></div></div><button className="secondary small" onClick={dismissGuide}>Got it</button></div>:null}

    {!assignment ? (
      list && list.length === 0 ? (
        <Card>
          <div style={{textAlign:'center',padding:'32px 16px'}}>
            <h3 style={{margin:'0 0 8px',fontSize:'1.1rem',color:'#0f172a'}}>No KPI Target Assigned Yet</h3>
            <p className="muted small-copy" style={{maxWidth:'520px',margin:'0 auto 16px',color:'#64748b'}}>
              No KPI target template has been assigned to your role / department for this active cycle yet. Once HR or your Manager publishes or assigns a template matching your role, it will appear here automatically.
            </p>
            <button className="primary small" onClick={loadList}>Check For My Assigned KPI</button>
          </div>
        </Card>
      ) : <Loader/>
    ) : <>
      <div className="workflow-steps">
        <span className="done">1. Fill KPI</span>
        <span className={['submitted','manager_reviewed','finalized'].includes(assignment.status)?'done':''}>2. Submit</span>
        <span className={['manager_reviewed','finalized'].includes(assignment.status)?'done':''}>3. Manager review</span>
        <span className={assignment.status==='finalized'?'done':''}>4. HR final</span>
      </div>

      {isSubmitted ? (
        <Card style={{borderLeft: locked ? '4px solid #ef4444' : '4px solid #3b82f6', background: locked ? '#fef2f2' : '#eff6ff', marginBottom:'16px'}}>
          <div style={{display:'flex',justify:'space-between',alignItems:'center',flexWrap:'wrap',gap:'12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <Info size={22} style={{color: locked ? '#dc2626' : '#2563eb', flexShrink:0}}/>
              <div>
                <strong style={{color: locked ? '#991b1b' : '#1e40af', fontSize:'0.92rem'}}>
                  {locked ? '🔒 Single Submission Enforced (Form Locked)' : '🔓 Manager / HR Review & Edit Mode'}
                </strong>
                <p style={{margin:'2px 0 0', fontSize:'0.82rem', color: locked ? '#b91c1c' : '#1d4ed8'}}>
                  {locked 
                    ? `This KPI entry has already been submitted and is locked. Employees are permitted only 1 submission per period. Only HR and Super Admin have privileges to edit or reopen submitted entries.` 
                    : 'You are viewing this entry in Admin/HR mode. You can edit values directly or click "Unlock / Reopen for Employee" to permit employee corrections.'}
                </p>
              </div>
            </div>
            {isAdminOrHr ? (
              <button type="button" className="secondary small" onClick={reopenAssignment} style={{fontSize:'0.8rem', whiteSpace:'nowrap', color:'#1d4ed8', borderColor:'#93c5fd'}}>
                Unlock / Reopen for Employee
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="metric-grid compact">
        <Card><span>Employee</span><strong className="small-metric">{assignment.employee} {assignment.employee_no ? `(${assignment.employee_no})` : ''}</strong></Card>
        <Card><span>Cycle / Date</span><strong className="small-metric">{selectedDateLabel || assignment.cycle}</strong></Card>
        <Card><span>Form completion</span><strong>{completion}%</strong><div className="bar"><i style={{width:`${completion}%`}}/></div></Card>
        <Card>
          <div style={{display:'flex',justify:'space-between',alignItems:'center'}}>
            <div><span>Calculated score</span><strong>{Number(assignment.calculated_score||0).toFixed(1)}</strong><Status value={assignment.status}/></div>
            <button className="secondary small icon-button" title="Download PDF Report Summary" onClick={downloadPdfReport} style={{borderRadius:'8px',padding:'6px'}}>
              <Download size={14}/>
            </button>
          </div>
        </Card>
      </div>

      <div style={{display:'flex',justify:'space-between',alignItems:'center',background:'#f0f9ff',border:'1px solid #bae6fd',padding:'10px 14px',borderRadius:'8px',marginBottom:'16px',flexWrap:'wrap',gap:'10px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <CalendarDays size={20} style={{color:'#0284c7'}}/>
          <div>
            <div style={{fontSize:'0.88rem',fontWeight:700,color:'#0369a1'}}>
              Viewing & Downloading Period: <span style={{color:'#0284c7'}}>{selectedDateLabel || (selectedSummary ? monthYearLabel(selectedSummary) : assignment.cycle)}</span>
            </div>
            <div style={{fontSize:'0.75rem',color:'#075985'}}>
              {selectedDateLabel && /\d{1,2}\s+[A-Za-z]+/.test(selectedDateLabel) ? 'Showing inputs & scores filtered for selected date' : 'Showing inputs & scores for entire month'}
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          <button type="button" className="secondary small" onClick={openCalendar} style={{display:'inline-flex',alignItems:'center',gap:'6px',fontSize:'0.8rem'}}>
            <CalendarDays size={14}/>Change Filter / View
          </button>
          <button type="button" className="primary small" onClick={downloadPdfReport} style={{display:'inline-flex',alignItems:'center',gap:'6px',fontSize:'0.8rem'}}>
            <Download size={14}/>Download Report for Selected Period
          </button>
        </div>
      </div>

      {!hasRegisteredData ? (
        <Card style={{borderLeft:'4px solid #f59e0b',background:'#fffbeb',marginBottom:'16px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <Info size={24} style={{color:'#d97706',flexShrink:0}}/>
            <div>
              <strong style={{color:'#92400e',fontSize:'0.95rem'}}>
                No KPI Data Registered for {selectedDateLabel || (selectedSummary ? monthYearLabel(selectedSummary) : assignment.cycle)}
              </strong>
              <p style={{margin:'2px 0 0',fontSize:'0.82rem',color:'#b45309'}}>
                No actual achievement inputs or measurement details have been registered for this selected date/month yet. Enter achievement values below and click <b>Save draft</b> or <b>Submit KPI</b>. PDF report downloads are disabled for this period until data is entered.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="stack">
        {assignment.template.kras.map(kra=>{
          const kraScore=kra.items.reduce((s,i)=>s+Number(i.response?.score||0),0);
          return (
            <Card key={kra.id}>
              <div className="kra-title">
                <div>
                  <h3>{kra.name}</h3>
                  <p>{kra.items.length} KPI parameters · enter actual achievement, measurement details, and attach PDF evidence</p>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'4px'}}>
                  <div className="weight-chip">{kra.weight} marks weightage</div>
                  <div style={{fontSize:'0.85rem',fontWeight:700,color:'var(--color-primary,#2563eb)'}}>
                    Section score: {kraScore.toFixed(1)} / {kra.weight} marks
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                <table className="kpi-input-table">
                  <thead>
                    <tr>
                      <th>KPI parameter & Task</th>
                      <th>Measurement / Target</th>
                      <th>Your result</th>
                      <th>Weight</th>
                      <th>Marks gathered</th>
                      <th>Measurement notes & PDF evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kra.items.map(item=>{
                      const meta=item.config?.meta||{},v=values[item.id]||{};
                      return (
                        <tr key={item.id} style={{verticalAlign:'top'}}>
                          <td>
                            <strong>{item.question}</strong>
                            <Tooltip text={`Enter the actual result for this KPI. Input type: ${item.input_type}. ${item.direction==='lower'?'Lower values perform better.':'Higher values perform better.'}`}/>
                            {meta.task_responsibility?<div style={{fontSize:'0.8rem',color:'var(--color-text-secondary,#475569)',marginTop:'2px'}}>{meta.task_responsibility}</div>:null}
                            <div className="cell-help">{item.input_type.replaceAll('_',' ')} · {meta.frequency||'Monthly'}</div>
                          </td>
                          <td>
                            <div className="measurement-text">
                              {meta.measurement||'Fill actual measurement details completed for the selected period.'}
                              <div className="target-hint">Target: {item.target_value??(['choice','yesno'].includes(item.input_type)?'Choose an option':'Configured')}</div>
                              {meta.evidence_required?<span className="required-chip">PDF required</span>:null}
                            </div>
                          </td>
                          <td>
                            <div style={{minWidth:'140px'}}>
                              <Input disabled={locked} item={item} value={v} onChange={patch=>setValue(item.id,patch)}/>
                            </div>
                          </td>
                          <td><strong>{item.weight}</strong></td>
                          <td>
                            <strong style={{fontSize:'1.05rem',color:'var(--color-primary,#2563eb)'}}>
                              {Number(item.response?.score||0).toFixed(1)}
                            </strong>
                            <span style={{fontSize:'0.8rem',color:'var(--color-muted,#64748b)'}}> / {item.weight}</span>
                            <div className="cell-help">{Number(item.response?.achievement_pct||0).toFixed(0)}% score</div>
                          </td>
                          <td>
                            <div className="stack-tight" style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                              <input disabled={locked} value={v.remarks||''} onChange={e=>setValue(item.id,{remarks:e.target.value})} placeholder="Write actual measurement notes or details completed..." style={{fontSize:'0.85rem'}}/>
                              <FileUpload compact disabled={locked} accept=".pdf" help="PDF only · maximum 10 MB" label="Upload PDF evidence" value={v.evidence_file||null} onUploaded={file=>setValue(item.id,{evidence_file_id:file?.file_id||null,evidence_file:file||null})}/>
                              {v.evidence_file?<a className="evidence-link" href={apiFileUrl(v.evidence_file)} target="_blank" rel="noreferrer"><ExternalLink size={12}/>Open {v.evidence_file.filename}</a>:null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })}
      </div>

      {!locked ? (
        <div className="footer-actions sticky-actions" style={{display:'flex',justify:'space-between',alignItems:'center'}}>
          <button className="secondary" type="button" onClick={() => setShowImporter(true)}>
            <FileUp size={16}/>Import Excel / CSV Data
          </button>
          <div style={{display:'flex',gap:'10px'}}>
            <button className="secondary" onClick={save}>Save draft</button>
            <button className="primary" onClick={submit}>Submit KPI</button>
          </div>
        </div>
      ) : (
        <div className="locked-note">This KPI is locked after submission. Your manager verifies it, then HR finalizes the score.</div>
      )}
    </>}

    {/* Import Modal */}
    {showImporter ? (
      <Modal title="Import KPI values from Excel or CSV" onClose={()=>{setShowImporter(false);setImportPreview(null)}} className="wide-modal" actions={importPreview?<><button className="secondary" onClick={()=>{setShowImporter(false);setImportPreview(null)}}>Cancel</button><button className="primary" disabled={!importPreview.matched} onClick={applyImport}>Apply {importPreview.matched} matched row(s)</button></>:null}>
        <div style={{display:'flex',justify:'space-between',alignItems:'center',marginBottom:'12px',gap:'12px',flexWrap:'wrap'}}>
          <p className="muted small-copy" style={{margin:0}}>Use standard columns: <b>KPI Parameter | Actual Value | Remarks | Evidence File</b>.</p>
          <button className="secondary small" type="button" onClick={downloadSampleImportFile} style={{display:'inline-flex',alignItems:'center',gap:'6px',color:'var(--color-primary,#2563eb)'}}>
            <Download size={14}/>Download Sample Excel / CSV
          </button>
        </div>
        {!importPreview ? (
          <FileUpload onUploaded={parseImport} label="Choose KPI input file" help="XLSX, XLS or CSV · maximum 10 MB"/>
        ) : (
          <>
            <div className="import-summary"><strong>{importPreview.matched} matched</strong><span>{importPreview.unmatched} need manual review</span></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>From file</th><th>Matched KPI</th><th>Actual</th><th>Remarks</th><th>Evidence reference</th><th>Confidence</th></tr>
                </thead>
                <tbody>
                  {importPreview.rows.map((r,i)=><tr key={i} className={!r.matched?'unmatched-row':''}><td>{r.kpi_parameter}</td><td>{r.matched_question||'Not matched'}</td><td>{r.actual_value||'—'}</td><td>{r.remarks||'—'}</td><td>{r.evidence_file||'—'}</td><td>{r.matched?`${r.confidence}%`:'Review manually'}</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}
        {importBusy?<div className="helper-strip"><Info size={14}/> Reading and matching KPI rows...</div>:null}
      </Modal>
    ) : null}

    {/* Interactive Calendar Date & Month Picker Modal */}
    {showCalendar ? (
      <Modal 
        title="Select KPI Evaluation Month & Date" 
        onClose={()=>setShowCalendar(false)} 
        actions={
          <div style={{display:'flex',justify:'space-between',alignItems:'center',width:'100%',flexWrap:'wrap',gap:'8px'}}>
            <button className="secondary" onClick={() => applyCalendar(calendarMonth, calendarYear, null)}>
              Load Entire Month ({monthNames[calendarMonth]} {calendarYear})
            </button>
            <button className="primary" onClick={() => applyCalendar(calendarMonth, calendarYear, calendarDay)}>
              Filter by Date ({calendarDay} {monthNames[calendarMonth]} {calendarYear})
            </button>
          </div>
        }
      >
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div className="helper-strip" style={{margin:0}}>
            <strong>Calendar Modes:</strong> Click a month or "Load Entire Month" to show all data for the month. Or select a specific day to filter data for that exact date.
          </div>

          <div style={{display:'flex',justify:'space-between',alignItems:'center',background:'#f8fafc',padding:'10px 14px',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
            <span style={{fontSize:'0.85rem',fontWeight:600,color:'#64748b'}}>Year Selection:</span>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <button type="button" className="icon-button" onClick={() => setCalendarYear(y => y - 1)}><ChevronLeft size={16}/></button>
              <strong style={{fontSize:'1rem',color:'#0f172a'}}>{calendarYear}</strong>
              <button type="button" className="icon-button" onClick={() => setCalendarYear(y => y + 1)}><ChevronRight size={16}/></button>
            </div>
          </div>

          <div>
            <div style={{display:'flex',justify:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <strong style={{fontSize:'0.85rem',color:'#334155'}}>1. Choose Month:</strong>
              <span style={{fontSize:'0.75rem',color:'#2563eb',fontWeight:600}}>Clicking month loads full month data</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'8px'}}>
              {monthNames.map((mName, mIdx) => {
                const isSelected = calendarMonth === mIdx
                const hasData = (list || []).some(a => {
                  const { year, monthIdx } = parseAssignmentYearMonth(a)
                  const isPeriod = year === calendarYear && monthIdx === mIdx
                  if (!isPeriod) return false
                  return (a.progress_percent || 0) > 0 || (a.responses && a.responses.some(r => r.actual_numeric !== null || r.selected_option || r.remarks))
                })
                return (
                  <button
                    key={mName}
                    type="button"
                    onClick={() => {
                      setCalendarMonth(mIdx)
                      applyCalendar(mIdx, calendarYear, null)
                    }}
                    style={{
                      padding:'10px 6px',
                      borderRadius:'8px',
                      border: isSelected ? '2px solid #2563eb' : hasData ? '1px solid #93c5fd' : '1px solid #cbd5e1',
                      background: isSelected ? '#eff6ff' : hasData ? '#f0f9ff' : '#ffffff',
                      color: isSelected ? '#1d4ed8' : hasData ? '#0369a1' : '#0f172a',
                      fontWeight: isSelected || hasData ? 700 : 500,
                      cursor:'pointer',
                      touchAction:'manipulation',
                      fontSize:'0.85rem',
                      display:'flex',
                      flexDirection:'column',
                      alignItems:'center',
                      gap:'2px',
                      boxShadow: isSelected ? '0 0 0 3px #dbeafe' : 'none'
                    }}
                  >
                    <span>{mName}</span>
                    {hasData ? <span style={{fontSize:'0.65rem',color:'#0284c7',fontWeight:600}}>Data</span> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div style={{display:'flex',justify:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <strong style={{fontSize:'0.85rem',color:'#334155'}}>2. Choose Day / Date:</strong>
              <span style={{fontSize:'0.75rem',color:'#475569'}}>Clicking day filters by specific date</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:'6px'}}>
              {calendarDays.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setCalendarDay(day)
                    applyCalendar(calendarMonth, calendarYear, day)
                  }}
                  style={{
                    padding:'8px 4px',
                    borderRadius:'6px',
                    border: calendarDay === day ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: calendarDay === day ? '#2563eb' : '#ffffff',
                    color: calendarDay === day ? '#ffffff' : '#334155',
                    fontWeight: calendarDay === day ? 700 : 500,
                    cursor:'pointer',
                    touchAction:'manipulation',
                    fontSize:'0.8rem'
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {calendarError ? <div className="error-box">{calendarError}</div> : null}
        </div>
      </Modal>
    ) : null}
  </>
}
