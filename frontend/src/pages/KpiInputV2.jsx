import {useEffect,useMemo,useState} from 'react'
import {CalendarDays,CheckCircle2,Download,ExternalLink,FileUp,Info} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api,apiFileUrl,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import FileUpload from '../components/FileUpload'
import {Card,ErrorBox,Loader,Modal,PageHeader,Status,Tooltip} from '../components/UI'
import {assignmentDepartment,assignmentMonth,compareText} from '../lib/sorting'

function monthLabel(a){
  const value=a?.month||assignmentMonth(a)
  if(value&&/^\d{4}-\d{2}/.test(value)){
    const d=new Date(`${value.slice(0,7)}-01T00:00:00`)
    return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(d)
  }
  return a?.cycle||value||'Unknown month'
}

function scoreItem(item,value){
  const v=value||{},cfg=item.config||{},meta=cfg.meta||{},weight=Number(item.weight||0)
  const cap=Math.max(0,Number(meta.score_cap_pct??100)/100)
  if(['choice','yesno'].includes(item.input_type)){
    if(!v.selected_option)return 0
    const pct=Number((cfg.score_map||{})[v.selected_option]||0)
    return Math.round(weight*Math.max(0,Math.min(pct/100,cap))*100)/100
  }
  if(item.input_type==='rating'){
    if(v.actual_numeric===null||v.actual_numeric===undefined||v.actual_numeric==='')return 0
    const max=Math.max(1,Number(cfg.max_rating||5))
    return Math.round(weight*Math.max(0,Math.min(Number(v.actual_numeric)/max,cap))*100)/100
  }
  if(v.actual_numeric===null||v.actual_numeric===undefined||v.actual_numeric==='')return 0
  const actual=Number(v.actual_numeric)
  if(!Number.isFinite(actual))return 0
  let ratio=0
  if(meta.scoring_method==='direct_percentage'||(item.input_type==='percentage'&&item.target_value==null))ratio=actual/100
  else if(item.target_value==null)ratio=actual/100
  else if(item.direction==='lower'&&Number(item.target_value)===0)ratio=actual<=0?1:0
  else if(item.direction==='lower')ratio=actual<=Number(item.target_value)||actual<=0?1:Number(item.target_value)/actual
  else{const target=Number(item.target_value);ratio=target===0?(actual>=0?1:0):actual/target}
  ratio=Math.max(0,Math.min(ratio,cap))
  return Math.round(weight*ratio*100)/100
}

function achievement(item,value){const w=Number(item.weight||0);return w?Math.round(scoreItem(item,value)/w*1000)/10:0}

function AnswerInput({item,value,onChange,disabled}){
  const v=value||{},cfg=item.config||{}
  if(['choice','yesno'].includes(item.input_type))return <select disabled={disabled} value={v.selected_option||''} onChange={e=>onChange({selected_option:e.target.value})}><option value="">Select answer...</option>{Object.keys(cfg.score_map||{}).map(o=><option key={o} value={o}>{o} ({cfg.score_map[o]}%)</option>)}</select>
  if(item.input_type==='rating')return <input disabled={disabled} type="number" min="1" max={cfg.max_rating||5} value={v.actual_numeric??''} onChange={e=>onChange({actual_numeric:e.target.value===''?null:Number(e.target.value)})}/>
  return <input disabled={disabled} type="number" step="0.01" value={v.actual_numeric??''} onChange={e=>onChange({actual_numeric:e.target.value===''?null:Number(e.target.value)})} placeholder={item.target_value!=null?`Target ${item.target_value}`:'Enter actual value'}/>
}

export default function KpiInputV2(){
  const{user}=useAuth()
  const[params,setParams]=useSearchParams()
  const id=params.get('assignment')
  const[list,setList]=useState(null),[assignment,setAssignment]=useState(null),[values,setValues]=useState({})
  const[department,setDepartment]=useState(''),[person,setPerson]=useState('')
  const[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const[showMonths,setShowMonths]=useState(false),[showImporter,setShowImporter]=useState(false),[importPreview,setImportPreview]=useState(null),[importBusy,setImportBusy]=useState(false)

  const isAdminOrHr=['superadmin','hr'].includes(user?.role)
  const submitted=assignment&&['submitted','manager_reviewed','finalized'].includes(assignment.status)
  const locked=submitted&&!isAdminOrHr

  const loadList=()=>api.get('/kpi/my').then(r=>{setList(r.data);if(!params.get('assignment')&&r.data[0])setParams({assignment:r.data[0].id})}).catch(e=>setError(getError(e)))
  useEffect(()=>{loadList()},[])

  async function loadAssignment(){
    if(!id)return
    setAssignment(null);setValues({})
    try{
      const{data}=await api.get(`/kpi/assignments/${id}`)
      setAssignment(data)
      const next={}
      data.template.kras.forEach(k=>k.items.forEach(i=>{next[i.id]={kpi_item_id:i.id,...(i.response||{})}}))
      setValues(next)
    }catch(e){setError(getError(e))}
  }
  useEffect(()=>{loadAssignment()},[id])

  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment).filter(Boolean))].sort(compareText),[list])
  const departmentRows=useMemo(()=>(list||[]).filter(a=>assignmentDepartment(a)===department),[list,department])
  const people=useMemo(()=>{
    const map=new Map()
    departmentRows.forEach(a=>{const key=String(a.employee_id);if(!map.has(key))map.set(key,{key,name:a.employee,no:a.employee_no||'',designation:a.designation||''})})
    return[...map.values()].sort((a,b)=>compareText(a.name,b.name))
  },[departmentRows])
  const personRows=useMemo(()=>departmentRows.filter(a=>String(a.employee_id)===person).sort((a,b)=>String(b.month||'').localeCompare(String(a.month||''))),[departmentRows,person])
  const currentSummary=(list||[]).find(a=>String(a.id)===String(id))

  useEffect(()=>{
    if(!list?.length)return
    const current=currentSummary||list[0]
    setDepartment(assignmentDepartment(current));setPerson(String(current.employee_id))
  },[list,id])

  function selectDepartment(value){
    setDepartment(value)
    const first=(list||[]).filter(a=>assignmentDepartment(a)===value).sort((a,b)=>compareText(a.employee,b.employee))[0]
    if(first){setPerson(String(first.employee_id));setParams({assignment:first.id})}
  }
  function selectPerson(value){setPerson(value);const first=departmentRows.find(a=>String(a.employee_id)===value);if(first)setParams({assignment:first.id})}
  function selectMonth(a){setParams({assignment:a.id});setShowMonths(false)}

  const allItems=useMemo(()=>assignment?assignment.template.kras.flatMap(k=>k.items):[],[assignment])
  const isAnswered=item=>{const v=values[item.id]||{};return['choice','yesno'].includes(item.input_type)?Boolean(v.selected_option):v.actual_numeric!==null&&v.actual_numeric!==undefined&&v.actual_numeric!==''}
  const missing=allItems.filter(i=>!isAnswered(i))
  const completion=allItems.length?Math.round((allItems.length-missing.length)/allItems.length*100):0
  const liveScore=Math.min(100,Math.round(allItems.reduce((s,i)=>s+scoreItem(i,values[i.id]),0)*100)/100)
  const ready=allItems.length>0&&missing.length===0

  function setValue(itemId,patch){setValues(current=>({...current,[itemId]:{...current[itemId],...patch,kpi_item_id:itemId}}));setError('');setMessage('')}
  function payload(){return allItems.map(i=>({kpi_item_id:i.id,actual_numeric:values[i.id]?.actual_numeric??null,answer_text:values[i.id]?.answer_text??null,selected_option:values[i.id]?.selected_option??null,measurement:values[i.id]?.remarks??values[i.id]?.measurement??null,remarks:values[i.id]?.remarks??null,evidence_url:values[i.id]?.evidence_url??null,evidence_file_id:values[i.id]?.evidence_file_id??null}))}

  async function save(){
    if(!id||busy)return false
    setBusy(true);setError('');setMessage('')
    try{const{data}=await api.put(`/kpi/assignments/${id}/responses`,payload());setMessage(`Draft saved. Score: ${Number(data.score||0).toFixed(1)}/100`);await loadAssignment();loadList();return true}catch(e){setError(getError(e));return false}finally{setBusy(false)}
  }
  async function submit(){
    if(!ready){setError(`Complete all KPI values before submitting. ${missing.length} KPI parameter${missing.length===1?' is':'s are'} still missing.`);return}
    setBusy(true);setError('');setMessage('')
    try{
      const saved=await api.put(`/kpi/assignments/${id}/responses`,payload())
      const{data}=await api.post(`/kpi/assignments/${id}/submit`)
      setMessage(`Submitted successfully. Score: ${Number(data.score??saved.data.score??liveScore).toFixed(1)}/100.`)
      await loadAssignment();loadList()
    }catch(e){setError(getError(e))}finally{setBusy(false)}
  }
  async function reopen(){try{await api.post(`/kpi/assignments/${id}/reopen`,{reason:`Reopened by ${user?.name||'HR'}`});setMessage('KPI reopened for editing.');await loadAssignment();loadList()}catch(e){setError(getError(e))}}

  async function exportPdf(){
    if(!id)return
    if(!allItems.some(isAnswered)){setError('Enter KPI values before downloading the report.');return}
    try{
      await api.put(`/kpi/assignments/${id}/responses`,payload())
      const label=monthLabel(currentSummary||assignment)
      const response=await api.get(`/kpi/assignments/${id}/pdf?date_label=${encodeURIComponent(label)}`,{responseType:'blob'})
      const blob=new Blob([response.data],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;a.download=`kpi_${(assignment.employee||'employee').replace(/\s+/g,'_')}_${label.replace(/\s+/g,'_')}.pdf`;a.click();URL.revokeObjectURL(url)
    }catch(e){setError(getError(e))}
  }

  async function parseImport(fileMeta){
    if(!fileMeta||!id)return
    setImportBusy(true);setError('')
    try{const fd=new FormData();fd.append('file_id',fileMeta.file_id);fd.append('assignment_id',id);const{data}=await api.post('/files/parse-kpi-excel',fd,{headers:{'Content-Type':'multipart/form-data'}});setImportPreview(data)}catch(e){setError(getError(e))}finally{setImportBusy(false)}
  }
  function applyImport(){
    if(!importPreview)return
    setValues(current=>{const next={...current};importPreview.rows.forEach(r=>{if(!r.matched||!r.kpi_item_id)return;const item=allItems.find(i=>i.id===r.kpi_item_id);if(!item)return;next[item.id]={...next[item.id],kpi_item_id:item.id,remarks:r.remarks||next[item.id]?.remarks||''};if(['choice','yesno'].includes(item.input_type))next[item.id].selected_option=r.selected_option||next[item.id]?.selected_option||'';else if(r.actual_numeric!==null&&r.actual_numeric!==undefined)next[item.id].actual_numeric=r.actual_numeric});return next})
    setImportPreview(null);setShowImporter(false);setMessage('Imported KPI values applied. Review the live marks before submitting.')
  }

  return<>
    <PageHeader title="KPI Input" subtitle="Department → Employee → Month. Enter actual achievement and see marks immediately." actions={<button className="secondary" disabled={!id} onClick={exportPdf}><Download size={16}/>Export PDF Report</button>}/>

    <div className="kpi-selector-bar">
      <div><strong>1. Department</strong><select value={department} onChange={e=>selectDepartment(e.target.value)}><option value="">Choose department</option>{departments.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
      <div><strong>2. Employee</strong><select value={person} onChange={e=>selectPerson(e.target.value)} disabled={!department}><option value="">Choose employee</option>{people.map(p=><option key={p.key} value={p.key}>{p.name}{p.no?` (${p.no})`:''}{p.designation?` · ${p.designation}`:''}</option>)}</select></div>
      <div><strong>3. Month</strong><button className="calendar-trigger" type="button" onClick={()=>setShowMonths(true)} style={{width:'100%',height:'42px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#fff',border:'1px solid #cbd5e1',padding:'0 12px',borderRadius:'8px'}}><span style={{display:'flex',gap:'8px',alignItems:'center'}}><CalendarDays size={18} style={{color:'#2563eb'}}/>{monthLabel(currentSummary)}</span><span style={{fontSize:'0.75rem',color:'#2563eb'}}>Change month</span></button></div>
    </div>

    <div className="helper-strip">PDF evidence and description are <strong>optional</strong>. Only the KPI result/answer is required for submission.</div>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}

    {!assignment?<Loader/>:<>
      {submitted?<Card style={{marginBottom:'14px',borderLeft:locked?'4px solid #ef4444':'4px solid #3b82f6'}}><div style={{display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'center'}}><div><strong>{locked?'KPI submitted and locked':'Submitted KPI - admin review mode'}</strong><div className="cell-help">Status: {assignment.status}</div></div>{isAdminOrHr?<button className="secondary small" onClick={reopen}>Reopen for editing</button>:null}</div></Card>:null}

      <div className="metric-grid compact">
        <Card><span>Employee</span><strong className="small-metric">{assignment.employee}{assignment.employee_no?` (${assignment.employee_no})`:''}</strong></Card>
        <Card><span>Month</span><strong className="small-metric">{monthLabel(currentSummary)}</strong></Card>
        <Card><span>Completion</span><strong>{completion}%</strong><div className="bar"><i style={{width:`${completion}%`}}/></div></Card>
        <Card><span>Live marks scored</span><strong>{liveScore.toFixed(1)} / 100</strong><Status value={assignment.status}/></Card>
      </div>

      {!locked?<Card style={{marginBottom:'14px',borderLeft:ready?'4px solid #16a34a':'4px solid #f59e0b',background:ready?'#f0fdf4':'#fffbeb'}}><div style={{display:'flex',gap:'10px',alignItems:'center'}}>{ready?<CheckCircle2 size={20} style={{color:'#16a34a'}}/>:<Info size={20} style={{color:'#d97706'}}/>}<div><strong>{ready?'Ready to submit':'Complete KPI answers'}</strong><div className="cell-help">{ready?`All KPI answers are filled. Optional PDF/description can be left empty. Current score ${liveScore.toFixed(1)}/100.`:`${missing.length} KPI answer${missing.length===1?'':'s'} remaining.`}</div></div></div></Card>:null}

      <div className="stack">{assignment.template.kras.map(kra=>{
        const sectionScore=kra.items.reduce((s,i)=>s+scoreItem(i,values[i.id]),0)
        return <Card key={kra.id}><div className="kra-title"><div><h3>{kra.name}</h3><p>{kra.items.length} KPI parameters</p></div><div style={{textAlign:'right'}}><div className="weight-chip">{kra.weight} marks weightage</div><div style={{fontSize:'0.82rem',fontWeight:700,color:'#2563eb',marginTop:'4px'}}>Section score: {sectionScore.toFixed(1)} / {kra.weight}</div></div></div><div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter & task</th><th>Measurement / target</th><th>Your result</th><th>Weight</th><th>Marks scored</th><th>Optional description & PDF</th></tr></thead><tbody>{kra.items.map(item=>{const v=values[item.id]||{},meta=item.config?.meta||{},mark=scoreItem(item,v);return <tr key={item.id} style={{verticalAlign:'top'}}><td><strong>{item.question}</strong><Tooltip text={`Input: ${item.input_type}. ${item.direction==='lower'?'Lower is better.':'Higher is better.'}`}/>{meta.task_responsibility?<div className="cell-help">{meta.task_responsibility}</div>:null}</td><td>{meta.measurement||'Enter the actual result for this KPI.'}<div className="target-hint">Target: {item.target_value??(['choice','yesno'].includes(item.input_type)?'Choose option':'Configured')}</div></td><td><AnswerInput disabled={locked} item={item} value={v} onChange={patch=>setValue(item.id,patch)}/></td><td><strong>{item.weight}</strong></td><td><strong style={{fontSize:'1.05rem',color:'#2563eb'}}>{mark.toFixed(1)}</strong><span className="muted"> / {item.weight}</span><div className="cell-help">{achievement(item,v).toFixed(0)}%</div></td><td><div className="stack-tight"><input disabled={locked} value={v.remarks||''} onChange={e=>setValue(item.id,{remarks:e.target.value})} placeholder="Optional description / notes"/><FileUpload compact disabled={locked} accept=".pdf" help="Optional PDF · max 10 MB" label="Optional PDF evidence" value={v.evidence_file||null} onUploaded={file=>setValue(item.id,{evidence_file_id:file?.file_id||null,evidence_file:file||null})}/>{v.evidence_file?<a className="evidence-link" href={apiFileUrl(v.evidence_file)} target="_blank" rel="noreferrer"><ExternalLink size={12}/>Open {v.evidence_file.filename}</a>:null}</div></td></tr>})}</tbody></table></div></Card>
      })}</div>

      {!locked?<div className="footer-actions sticky-actions" style={{display:'flex',justifyContent:'space-between'}}><button className="secondary" onClick={()=>setShowImporter(true)}><FileUp size={16}/>Import Excel / CSV</button><div style={{display:'flex',gap:'10px'}}><button className="secondary" disabled={busy} onClick={save}>{busy?'Saving...':'Save draft'}</button><button className="primary" disabled={busy||!ready} onClick={submit}>{busy?'Working...':'Submit KPI'}</button></div></div>:<div className="locked-note">This KPI is locked after submission.</div>}
    </>}

    {showMonths?<Modal title="Select KPI month" onClose={()=>setShowMonths(false)} actions={<button className="secondary" onClick={()=>setShowMonths(false)}>Close</button>}><div style={{display:'grid',gap:'8px'}}>{personRows.length?personRows.map(a=><button key={a.id} className={String(a.id)===String(id)?'primary':'secondary'} onClick={()=>selectMonth(a)} style={{justifyContent:'space-between'}}><span>{monthLabel(a)}</span><Status value={a.status}/></button>):<div className="empty">No KPI months assigned for this employee.</div>}</div></Modal>:null}

    {showImporter?<Modal title="Import KPI values from Excel or CSV" onClose={()=>{setShowImporter(false);setImportPreview(null)}} className="wide-modal" actions={importPreview?<><button className="secondary" onClick={()=>{setShowImporter(false);setImportPreview(null)}}>Cancel</button><button className="primary" disabled={!importPreview.matched} onClick={applyImport}>Apply {importPreview.matched} matched rows</button></>:null}>{!importPreview?<FileUpload onUploaded={parseImport} label="Choose KPI input file" help="XLSX, XLS or CSV · maximum 10 MB"/>:<><div className="import-summary"><strong>{importPreview.matched} matched</strong><span>{importPreview.unmatched} need manual review</span></div><div className="table-wrap"><table><thead><tr><th>From file</th><th>Matched KPI</th><th>Actual</th><th>Description</th></tr></thead><tbody>{importPreview.rows.map((r,i)=><tr key={i}><td>{r.kpi_parameter}</td><td>{r.matched_question||'Not matched'}</td><td>{r.actual_value||'—'}</td><td>{r.remarks||'—'}</td></tr>)}</tbody></table></div></>}{importBusy?<div className="helper-strip">Reading KPI rows...</div>:null}</Modal>:null}
  </>
}
