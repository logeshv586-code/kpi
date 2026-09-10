import {useEffect,useMemo,useState} from 'react'
import {CalendarDays,CheckCircle2,ChevronLeft,ChevronRight,Download,ExternalLink,Eye,FileUp,Info} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api,apiFileUrl,getError,apiPostForm} from '../lib/api'
import {useAuth} from '../lib/auth'
import FileUpload from '../components/FileUpload'
import {Card,ErrorBox,Loader,Modal,PageHeader,Status} from '../components/UI'
import {assignmentDepartment,compareText} from '../lib/sorting'

const numericTypes=['number','percentage','currency','days','count']
const whole=value=>Math.round(Number(value||0))
const score2=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100
const scoreText=value=>score2(value).toFixed(2)
const isChoice=item=>['choice','yesno'].includes(item?.input_type)
const isKraAverage100=item=>item?.config?.meta?.scoring_model==='kra_average_100'
const minimumScore=item=>{
  const meta=item?.config?.meta||{},value=Number(meta.minimum_score??meta.threshold_min??0)
  return Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value))):0
}

function periodLabel(a){
  if(!a)return'Choose review period'
  if(a.period_label)return a.period_label
  const value=a?.month
  if(value&&/^\d{4}-\d{2}/.test(value)){
    const d=new Date(`${value.slice(0,7)}-01T00:00:00`)
    return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(d)
  }
  return a?.cycle||value||'Unknown review period'
}

function thresholdInfo(item,value,prefix=''){
  if(!numericTypes.includes(item.input_type))return{configured:isKraAverage100(item),passed:null,min:minimumScore(item),max:null}
  const meta=item.config?.meta||{},raw=value?.[`${prefix}actual_numeric`]
  if(isKraAverage100(item)){
    const min=minimumScore(item)
    if(raw===null||raw===undefined||raw==='')return{configured:true,passed:null,min,max:null}
    const actual=Number(raw),passed=Number.isFinite(actual)&&actual>=min
    return{configured:true,passed,min,max:null,actual,reason:passed?'Minimum achieved':`Minimum ${min} not achieved`}
  }
  const min=meta.threshold_min===null||meta.threshold_min===undefined||meta.threshold_min===''?null:Number(meta.threshold_min)
  const max=meta.threshold_max===null||meta.threshold_max===undefined||meta.threshold_max===''?null:Number(meta.threshold_max)
  const rule=meta.threshold_rule&&meta.threshold_rule!=='none'?meta.threshold_rule:(min!==null&&max!==null?'range':min!==null?'minimum':max!==null?'maximum':'none')
  if(rule==='none'||(min===null&&max===null))return{configured:false,passed:null,rule,min,max}
  if(raw===null||raw===undefined||raw==='')return{configured:true,passed:null,rule,min,max}
  const actual=Number(raw)
  let passed=true,reason='Threshold achieved'
  if(rule==='minimum'&&min!==null){passed=actual>=min;reason=passed?'Minimum achieved':`Minimum ${min} not achieved`}
  else if(rule==='maximum'&&max!==null){passed=actual<=max;reason=passed?'Maximum limit met':`Maximum ${max} exceeded`}
  else if(rule==='range'){
    if(min!==null&&actual<min){passed=false;reason=`Minimum ${min} not achieved`}
    else if(max!==null&&actual>max){passed=false;reason=`Maximum ${max} exceeded`}
    else reason='Within acceptable range'
  }
  return{configured:true,passed,rule,min,max,reason,actual}
}

function legacyItemScore(item,value,prefix=''){
  const v=value||{},cfg=item.config||{},meta=cfg.meta||{},weight=Number(item.weight||0)
  const cap=Math.max(0,Number(meta.score_cap_pct??100)/100)
  if(isChoice(item)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const pct=Number((cfg.score_map||{})[selected]||0)
    return whole(weight*Math.max(0,Math.min(pct/100,cap)))
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Number(raw)
  if(!Number.isFinite(actual)||thresholdInfo(item,v,prefix).passed===false)return 0
  let ratio=0
  if(meta.scoring_method==='direct_percentage'||(item.input_type==='percentage'&&item.target_value==null))ratio=actual/100
  else if(item.target_value==null)ratio=actual/100
  else if(item.direction==='lower'&&Number(item.target_value)===0)ratio=actual<=0?1:0
  else if(item.direction==='lower'){
    const target=Number(item.target_value);ratio=actual<=target||actual<=0?1:target/actual
  }else{
    const target=Number(item.target_value);ratio=target===0?(actual>=0?1:0):actual/target
  }
  return whole(weight*Math.max(0,Math.min(ratio,cap)))
}

function kpiScore100(item,value,prefix=''){
  const v=value||{},cfg=item.config||{}
  if(!isKraAverage100(item)){
    const weight=Number(item.weight||0),legacy=legacyItemScore(item,value,prefix)
    return weight>0?whole(legacy/weight*100):0
  }
  if(isChoice(item)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const raw=whole(Math.max(0,Math.min(100,Number((cfg.score_map||{})[selected]||0))))
    return raw<minimumScore(item)?0:raw
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=whole(Number(raw))
  if(!Number.isFinite(actual))return 0
  return actual<minimumScore(item)?0:Math.max(0,Math.min(100,actual))
}

function kraAverage(kra,values,prefix=''){
  if(!kra?.items?.length)return 0
  if(kra.items.every(isKraAverage100))return kra.items.reduce((sum,item)=>sum+kpiScore100(item,values[item.id],prefix),0)/kra.items.length
  const weight=Number(kra.weight||0)
  if(weight<=0)return 0
  return kra.items.reduce((sum,item)=>sum+legacyItemScore(item,values[item.id],prefix),0)/weight*100
}

function kraScore(kra,values,prefix=''){
  if(!kra?.items?.length)return 0
  if(kra.items.every(isKraAverage100))return kraAverage(kra,values,prefix)*Number(kra.weight||0)/100
  return kra.items.reduce((sum,item)=>sum+legacyItemScore(item,values[item.id],prefix),0)
}

function templateScore(kras,values,prefix=''){
  return Math.min(100,score2((kras||[]).reduce((sum,kra)=>sum+kraScore(kra,values,prefix),0)))
}

function AnswerInput({item,value,onChange,disabled,prefix=''}){
  const v=value||{},cfg=item.config||{}
  if(isChoice(item)){
    const options=Object.keys(cfg.score_map||{})
    return <select disabled={disabled} value={v[`${prefix}selected_option`]||''} onChange={e=>onChange({[`${prefix}selected_option`]:e.target.value})}><option value="">Select result...</option>{options.map(option=><option key={option} value={option}>{option}</option>)}</select>
  }
  const current=v[`${prefix}actual_numeric`]
  return <input disabled={disabled} type="number" min="0" max={isKraAverage100(item)?100:undefined} step="1" value={current==null?'':Math.round(Number(current))} onChange={e=>{if(e.target.value===''){onChange({[`${prefix}actual_numeric`]:null});return}const next=Math.round(Number(e.target.value));onChange({[`${prefix}actual_numeric`]:isKraAverage100(item)?Math.max(0,Math.min(100,next)):next})}} placeholder={isKraAverage100(item)?'0 - 100':'Enter achieved value'}/>
}

function CalculatedValue({item,value,prefix=''}){
  if(isChoice(item)){
    const selected=value?.[`${prefix}selected_option`]
    if(!selected)return <span className="cell-help">—</span>
    const raw=whole(Number((item.config?.score_map||{})[selected]||0)),calculated=kpiScore100(item,value,prefix)
    const failed=isKraAverage100(item)&&raw<minimumScore(item)
    return <div className="kpi-threshold-summary"><strong>{calculated}</strong> / 100{failed?<div className="threshold-not-achieved">Below minimum {minimumScore(item)} → 0</div>:<div className="threshold-achieved">Qualified</div>}</div>
  }
  const raw=value?.[`${prefix}actual_numeric`]
  if(isKraAverage100(item)){
    if(raw===null||raw===undefined||raw==='')return <span className="cell-help">—</span>
    const calculated=kpiScore100(item,value,prefix),minimum=minimumScore(item)
    return <div className="kpi-threshold-summary"><strong>{calculated}</strong> / 100{Number(raw)<minimum?<div className="threshold-not-achieved">Below minimum {minimum} → 0</div>:<div className="threshold-achieved">Qualified</div>}</div>
  }
  return <strong>{kpiScore100(item,value,prefix)}</strong>
}

export default function KpiInputV2(){
  const{user}=useAuth(),[params,setParams]=useSearchParams(),id=params.get('assignment')
  const[list,setList]=useState(null),[assignment,setAssignment]=useState(null),[values,setValues]=useState({})
  const[department,setDepartment]=useState(''),[person,setPerson]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const[showMonths,setShowMonths]=useState(false),[selectedYear,setSelectedYear]=useState(new Date().getFullYear()),[showImporter,setShowImporter]=useState(false),[importPreview,setImportPreview]=useState(null),[importBusy,setImportBusy]=useState(false)

  const isAdminOrHr=['superadmin','hr'].includes(user?.role)
  const isAssignedManager=assignment&&user?.role==='manager'&&assignment.manager_id===user.id
  const isManagerMode=isAdminOrHr||isAssignedManager
  const submitted=assignment&&['submitted','manager_reviewed','finalized'].includes(assignment.status)
  const locked=(submitted&&!isManagerMode)||(assignment?.cycle_status==='closed')||Boolean(assignment?.is_locked&&!isAdminOrHr)
  const managerLocked=(assignment?.status==='finalized'&&!isAdminOrHr)||(assignment?.cycle_status==='closed')

  const loadList=()=>api.get('/kpi/my').then(r=>{setList(r.data);if(!params.get('assignment')&&r.data[0])setParams({assignment:r.data[0].id})}).catch(e=>setError(getError(e)))
  useEffect(()=>{loadList()},[])

  async function loadAssignment(){
    if(!id)return
    setAssignment(null);setValues({})
    try{
      const{data}=await api.get(`/kpi/assignments/${id}`)
      setAssignment(data)
      const next={}
      data.template.kras.forEach(kra=>kra.items.forEach(item=>{next[item.id]={kpi_item_id:item.id,...(item.response||{})}}))
      setValues(next)
    }catch(e){setError(getError(e))}
  }
  useEffect(()=>{loadAssignment()},[id])

  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment).filter(Boolean))].sort(compareText),[list])
  const departmentRows=useMemo(()=>(list||[]).filter(a=>assignmentDepartment(a)===department),[list,department])
  const people=useMemo(()=>{const map=new Map();departmentRows.forEach(a=>{const key=String(a.employee_id);if(!map.has(key))map.set(key,{key,name:a.employee,no:a.employee_no||'',designation:a.designation||''})});return[...map.values()].sort((a,b)=>compareText(a.name,b.name))},[departmentRows])
  const personRows=useMemo(()=>departmentRows.filter(a=>String(a.employee_id)===person).sort((a,b)=>String(b.month||'').localeCompare(String(a.month||''))||String(b.id).localeCompare(String(a.id))),[departmentRows,person])
  const currentSummary=(list||[]).find(a=>String(a.id)===String(id))

  useEffect(()=>{if(!list?.length)return;const current=currentSummary||list[0];setDepartment(assignmentDepartment(current));setPerson(String(current.employee_id))},[list,id])
  function selectDepartment(value){setDepartment(value);const first=(list||[]).filter(a=>assignmentDepartment(a)===value).sort((a,b)=>compareText(a.employee,b.employee))[0];if(first){setPerson(String(first.employee_id));setParams({assignment:first.id})}}
  function selectPerson(value){setPerson(value);const first=departmentRows.find(a=>String(a.employee_id)===value);if(first)setParams({assignment:first.id})}
  function selectPeriod(value){if(value)setParams({assignment:value})}

  const allItems=useMemo(()=>assignment?assignment.template.kras.flatMap(k=>k.items):[],[assignment])
  const isAnswered=item=>{const v=values[item.id]||{};return isChoice(item)?Boolean(v.selected_option):v.actual_numeric!==null&&v.actual_numeric!==undefined&&v.actual_numeric!==''}
  const missing=allItems.filter(item=>!isAnswered(item)),completion=allItems.length?whole((allItems.length-missing.length)/allItems.length*100):0
  const liveScore=assignment?templateScore(assignment.template.kras,values):0
  const liveManagerScore=assignment?templateScore(assignment.template.kras,values,'manager_'):0
  const ready=allItems.length>0&&missing.length===0

  function setValue(itemId,patch){setValues(current=>({...current,[itemId]:{...current[itemId],...patch,kpi_item_id:itemId}}));setError('');setMessage('')}
  function payload(){return allItems.map(item=>({kpi_item_id:item.id,actual_numeric:values[item.id]?.actual_numeric??null,answer_text:values[item.id]?.answer_text??null,selected_option:values[item.id]?.selected_option??null,manager_actual_numeric:values[item.id]?.manager_actual_numeric??null,manager_selected_option:values[item.id]?.manager_selected_option??null,measurement:values[item.id]?.remarks??values[item.id]?.measurement??null,remarks:values[item.id]?.remarks??null,evidence_url:values[item.id]?.evidence_url??null,evidence_file_id:values[item.id]?.evidence_file_id??null}))}

  async function save(){if(!id||busy)return false;setBusy(true);setError('');setMessage('');try{const{data}=await api.put(`/kpi/assignments/${id}/responses`,payload());setMessage(`Draft saved. Final score: ${scoreText(data.score)}/100`);await loadAssignment();loadList();return true}catch(e){setError(getError(e));return false}finally{setBusy(false)}}
  async function submit(){if(!ready){setError(`Complete all KPI inputs before submitting. ${missing.length} KPI${missing.length===1?' is':'s are'} still missing.`);return}setBusy(true);setError('');setMessage('');try{const saved=await api.put(`/kpi/assignments/${id}/responses`,payload());const{data}=await api.post(`/kpi/assignments/${id}/submit`);setMessage(`Submitted successfully. Final score: ${scoreText(data.score??saved.data.score??liveScore)}/100.`);await loadAssignment();loadList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function reopen(){try{await api.post(`/kpi/assignments/${id}/reopen`,{reason:`Reopened by ${user?.name||'HR'}`});setMessage('KPI reopened for editing.');await loadAssignment();loadList()}catch(e){setError(getError(e))}}

  async function downloadAssignmentPdf(targetAssignment){if(!targetAssignment?.id)return;try{const label=periodLabel(targetAssignment),response=await api.get(`/kpi/assignments/${targetAssignment.id}/pdf?date_label=${encodeURIComponent(label)}`,{responseType:'blob'}),blob=new Blob([response.data],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kpi_${(targetAssignment.employee||'employee').replace(/\s+/g,'_')}_${label.replace(/\s+/g,'_')}.pdf`;a.click();URL.revokeObjectURL(url)}catch(e){setError(getError(e))}}
  async function exportPdf(){if(!id)return;if(!allItems.some(isAnswered)){setError('Enter KPI values before downloading the report.');return}try{await api.put(`/kpi/assignments/${id}/responses`,payload());await downloadAssignmentPdf(currentSummary||assignment)}catch(e){setError(getError(e))}}

  async function parseImport(fileMeta){if(!fileMeta||!id)return;setImportBusy(true);setError('');try{const fd=new FormData();fd.append('file_id',fileMeta.file_id);fd.append('assignment_id',id);const{data}=await apiPostForm('/files/parse-kpi-excel',fd);setImportPreview(data)}catch(e){setError(getError(e))}finally{setImportBusy(false)}}
  function applyImport(){if(!importPreview)return;setValues(current=>{const next={...current};importPreview.rows.forEach(row=>{if(!row.matched||!row.kpi_item_id)return;const item=allItems.find(i=>i.id===row.kpi_item_id);if(!item)return;next[item.id]={...next[item.id],kpi_item_id:item.id,remarks:row.remarks||next[item.id]?.remarks||''};if(isChoice(item))next[item.id].selected_option=row.selected_option||next[item.id]?.selected_option||'';else if(row.actual_numeric!==null&&row.actual_numeric!==undefined)next[item.id].actual_numeric=isKraAverage100(item)?Math.max(0,Math.min(100,Math.round(Number(row.actual_numeric)))):Math.round(Number(row.actual_numeric))});return next});setImportPreview(null);setShowImporter(false);setMessage('Imported KPI inputs applied. Review the calculated KPI values and KRA scores before submitting.')}
  async function generateCycleAndLoad(){setBusy(true);setError('');try{await api.post('/kpi/cycles/auto-generate');await loadList()}catch(e){setError(getError(e))}finally{setBusy(false)}}

  return <>
    <PageHeader title="KPI Input" subtitle="Enter one whole-number value from 0 to 100 for each KPI. The calculated KPI is the same value when the minimum is met; otherwise it is 0." actions={<button className="secondary" disabled={!id} onClick={exportPdf}><Download size={16}/>Export PDF Report</button>}/>

    <div className="kpi-selector-bar">
      <div><strong>1. Department</strong><select value={department} onChange={e=>selectDepartment(e.target.value)}><option value="">Choose department</option>{departments.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
      <div><strong>2. Employee</strong><select value={person} onChange={e=>selectPerson(e.target.value)} disabled={!department}><option value="">Choose employee</option>{people.map(p=><option key={p.key} value={p.key}>{p.name}{p.no?` (${p.no})`:''}{p.designation?` · ${p.designation}`:''}</option>)}</select></div>
      <div><strong>3. Review Period</strong><div className="responsive-actions"><select value={String(id||'')} onChange={e=>selectPeriod(e.target.value)} disabled={!person}>{personRows.map(row=><option key={row.id} value={row.id}>{periodLabel(row)} · {(row.review_type||'monthly').replace('_',' ')}</option>)}</select><button className="calendar-trigger" type="button" onClick={()=>setShowMonths(true)} title="Browse all review periods"><CalendarDays size={18}/></button></div></div>
    </div>

    <div className="helper-strip"><strong>Formula:</strong> KPI base = 100. Calculated KPI = 0 when input is below minimum; otherwise calculated KPI = input. KRA average = sum of calculated KPIs ÷ KPI count. KRA score = KRA average × KRA weight ÷ 100. Final score = sum of KRA scores.</div>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}

    {!list?<Loader/>:list.length===0?<Card className="empty-assignment-card"><h3>No Active KPI Assignments Found</h3><p>No published KPI assignment exists for this account yet.</p>{isAdminOrHr?<button className="primary" disabled={busy} onClick={generateCycleAndLoad}>{busy?'Generating...':'Generate & Refresh KPI Assignments'}</button>:null}</Card>:!assignment?<Loader/>:<>
      {submitted?<Card className="submitted-card"><div className="submitted-card-row"><div><strong>{locked?'KPI submitted and locked':'Submitted KPI - admin review mode'}</strong><div className="cell-help">Status: {assignment.status}</div></div>{isAdminOrHr?<button className="secondary small" onClick={reopen}>Reopen for editing</button>:null}</div></Card>:null}

      <div className="metric-grid compact">
        <Card><span>Employee</span><strong className="small-metric">{assignment.employee}{assignment.employee_no?` (${assignment.employee_no})`:''}</strong></Card>
        <Card><span>Review Period</span><strong className="small-metric">{assignment.period_label||periodLabel(currentSummary)}</strong><div className="cell-help">{(assignment.review_type||currentSummary?.review_type||'monthly').replace('_',' ')} · {assignment.financial_year||currentSummary?.financial_year||''}</div></Card>
        <Card><span>Completion</span><strong className="small-metric">{completion}%</strong><div className="cell-help">{missing.length} remaining</div></Card>
        <Card><span>Final Staff Score</span><strong className="small-metric">{scoreText(liveScore)}</strong><div className="cell-help">out of 100</div><Status value={assignment.status}/></Card>
      </div>

      {!locked?<Card className={ready?'ready-card':'pending-card'}><div className="ready-row">{ready?<CheckCircle2 size={20}/>:<Info size={20}/>}<div><strong>{ready?'Ready to submit':'Complete KPI inputs'}</strong><div className="cell-help">{ready?`All KPI values are filled. Current final score ${scoreText(liveScore)}/100.`:`${missing.length} KPI input${missing.length===1?'':'s'} remaining.`}</div></div></div></Card>:null}

      <div className="stack">{assignment.template.kras.map(kra=>{
        const staffAverage=kraAverage(kra,values),managerAverage=kraAverage(kra,values,'manager_')
        const staffKra=kraScore(kra,values),managerKra=kraScore(kra,values,'manager_')
        return <Card key={kra.id}>
          <div className="kra-title"><div><h3>{kra.name}</h3><p>{kra.items.length} KPI{kra.items.length===1?'':'s'} · each KPI is 100</p></div><div className="kra-score-summary"><div className="weight-chip">KRA weight {whole(kra.weight)} / 100</div><div>Average KPI: <strong>{scoreText(staffAverage)}</strong> · KRA score: <strong>{scoreText(staffKra)}</strong></div>{isManagerMode?<div className="cell-help">Manager average {scoreText(managerAverage)} · score {scoreText(managerKra)}</div>:null}</div></div>
          <div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter & task</th><th>KPI weight</th><th>Minimum</th><th>Your input</th><th>Calculated KPI</th><th>Manager input</th><th>Manager calculated</th><th>Optional description & PDF</th></tr></thead><tbody>{kra.items.map(item=>{
            const v=values[item.id]||{},meta=item.config?.meta||{}
            return <tr key={item.id}>
              <td><strong>{item.question}</strong>{meta.task_responsibility?<div className="cell-help">{meta.task_responsibility}</div>:null}{meta.measurement?<div className="cell-help">{meta.measurement}</div>:null}</td>
              <td><strong>{isKraAverage100(item)?100:whole(item.weight)}</strong>{isKraAverage100(item)?<div className="cell-help">fixed</div>:null}</td>
              <td><strong>{isKraAverage100(item)?minimumScore(item):'Legacy'}</strong></td>
              <td><AnswerInput disabled={locked} item={item} value={v} onChange={patch=>setValue(item.id,patch)}/></td>
              <td><CalculatedValue item={item} value={v}/></td>
              <td><AnswerInput disabled={managerLocked||!isManagerMode} item={item} value={v} prefix="manager_" onChange={patch=>setValue(item.id,patch)}/></td>
              <td><CalculatedValue item={item} value={v} prefix="manager_"/></td>
              <td><div className="stack-tight"><input disabled={locked} value={v.remarks||''} onChange={e=>setValue(item.id,{remarks:e.target.value})} placeholder="Optional description / notes"/><FileUpload compact disabled={locked} accept=".pdf" help="Optional PDF · max 10 MB" label="Optional PDF evidence" value={v.evidence_file||null} onUploaded={file=>setValue(item.id,{evidence_file_id:file?.file_id||null,evidence_file:file||null})}/>{v.evidence_file?<a className="evidence-link" href={apiFileUrl(v.evidence_file)} target="_blank" rel="noreferrer"><ExternalLink size={12}/>Open {v.evidence_file.filename}</a>:null}</div></td>
            </tr>
          })}</tbody></table></div>
        </Card>
      })}</div>

      {!locked?<div className="footer-actions sticky-actions"><button className="secondary" onClick={()=>setShowImporter(true)}><FileUp size={16}/>Import Excel / CSV</button><div className="responsive-actions"><button className="secondary" disabled={busy} onClick={save}>{busy?'Saving...':'Save draft'}</button><button className="primary" disabled={busy||!ready} onClick={submit}>{busy?'Working...':'Submit KPI'}</button></div></div>:<div className="locked-note">This KPI is locked after submission.</div>}
    </>}

    {showMonths?<Modal title={`KPI Review Periods - ${people.find(p=>p.key===person)?.name||'Employee'}`} onClose={()=>setShowMonths(false)} className="wide-modal" actions={<button className="secondary" onClick={()=>setShowMonths(false)}>Close</button>}>
      <div className="period-browser-head"><div className="responsive-actions"><button type="button" className="secondary small" onClick={()=>setSelectedYear(y=>y-1)}><ChevronLeft size={16}/>Prev Year</button><strong>{selectedYear}</strong><button type="button" className="secondary small" onClick={()=>setSelectedYear(y=>y+1)}>Next Year<ChevronRight size={16}/></button></div><div className="cell-help">Multiple Monthly / Quarterly / Half-Yearly / Annual reviews may exist in the same month.</div></div>
      <div className="period-card-grid">{personRows.filter(row=>String(row.month||'').startsWith(String(selectedYear))).map(row=>{const active=String(row.id)===String(id);return <div key={row.id} className={`calendar-month-card has-assignment ${active?'active-selected':''}`}><div className="calendar-month-header"><strong>{periodLabel(row)}</strong><Status value={row.status}/></div><div className="cell-help">{(row.review_type||'monthly').replace('_',' ')} · {row.financial_year||''}</div><div className="period-score">Score: {scoreText(row.final_score??row.manager_score??row.calculated_score)} / 100</div><div className="calendar-month-actions"><button type="button" className={active?'primary small':'secondary small'} onClick={()=>{selectPeriod(row.id);setShowMonths(false)}}><Eye size={13}/>View KPI</button><button type="button" className="secondary small" onClick={()=>downloadAssignmentPdf(row)}><Download size={13}/>PDF</button></div></div>})}</div>{!personRows.some(row=>String(row.month||'').startsWith(String(selectedYear)))?<div className="empty">No KPI review periods for {selectedYear}.</div>:null}
    </Modal>:null}

    {showImporter?<Modal title="Import KPI values from Excel or CSV" onClose={()=>{setShowImporter(false);setImportPreview(null)}} className="wide-modal" actions={importPreview?<><button className="secondary" onClick={()=>{setShowImporter(false);setImportPreview(null)}}>Cancel</button><button className="primary" disabled={!importPreview.matched} onClick={applyImport}>Apply {importPreview.matched} matched rows</button></>:null}>{!importPreview?<FileUpload onUploaded={parseImport} label="Choose KPI input file" help="XLSX, XLS or CSV · maximum 10 MB"/>:<><div className="import-summary"><strong>{importPreview.matched} matched</strong><span>{importPreview.unmatched} need manual review</span></div><div className="table-wrap"><table className="responsive-data-table"><thead><tr><th>From file</th><th>Matched KPI</th><th>Input</th><th>Description</th></tr></thead><tbody>{importPreview.rows.map((r,i)=><tr key={i}><td data-label="From file">{r.kpi_parameter}</td><td data-label="Matched KPI">{r.matched_question||'Not matched'}</td><td data-label="Input">{r.actual_value||'—'}</td><td data-label="Description">{r.remarks||'—'}</td></tr>)}</tbody></table></div></>}{importBusy?<div className="helper-strip">Reading KPI rows...</div>:null}</Modal>:null}
  </>
}
