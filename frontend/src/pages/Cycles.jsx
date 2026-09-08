import {useEffect, useMemo, useState} from 'react'
import {CalendarPlus, Plus} from 'lucide-react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Status} from '../components/UI'

const typeLabel={monthly:'Monthly',quarterly:'Quarterly',half_yearly:'Half-Yearly',annual:'Annual'}

function financialYear(month){
  if(!month)return''
  const [year,mon]=month.split('-').map(Number)
  const start=mon>=4?year:year-1
  return `FY ${start}-${String(start+1).slice(-2)}`
}
function periodLabel(type,month){
  if(!month)return''
  const d=new Date(`${month.slice(0,7)}-01T00:00:00`)
  const mon=d.getMonth()+1
  const fy=financialYear(month)
  if(type==='monthly')return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(d)
  if(type==='quarterly')return({6:`Q1 · ${fy}`,9:`Q2 · ${fy}`,12:`Q3 · ${fy}`,3:`Q4 · ${fy}`}[mon]||'')
  if(type==='half_yearly')return({9:`H1 · ${fy}`,3:`H2 · ${fy}`}[mon]||'')
  if(type==='annual')return mon===3?`Annual · ${fy}`:''
  return''
}
function validReviewMonth(type,month){
  if(!month)return true
  const mon=Number(month.slice(5,7))
  if(type==='quarterly')return[3,6,9,12].includes(mon)
  if(type==='half_yearly')return[3,9].includes(mon)
  if(type==='annual')return mon===3
  return true
}

export default function Cycles(){
  const[rows,setRows]=useState(null)
  const[show,setShow]=useState(false)
  const[form,setForm]=useState({name:'September 2026 Monthly Review',month:'2026-09-01',start_date:'2026-09-01',end_date:'2026-09-30',status:'upcoming',review_type:'monthly',financial_year:'FY 2026-27',period_label:'September 2026'})
  const[error,setError]=useState('')
  const[fieldErrors,setFieldErrors]=useState({})
  const[message,setMessage]=useState('')
  const load=()=>api.get('/kpi/cycles').then(r=>setRows(r.data)).catch(e=>setError(getError(e)))
  useEffect(()=>{load()},[])

  const allowedMonth=useMemo(()=>validReviewMonth(form.review_type,form.month),[form.review_type,form.month])

  function updatePeriod(patch){
    const next={...form,...patch}
    if(patch.month!==undefined||patch.review_type!==undefined){
      next.financial_year=financialYear(next.month)
      next.period_label=periodLabel(next.review_type,next.month)
      if(next.period_label){
        const suffix=typeLabel[next.review_type]||'Review'
        next.name=next.review_type==='monthly'?`${next.period_label} Monthly Review`:`${next.period_label} ${suffix} Review`
      }
      if(next.review_type==='monthly'&&next.month){
        const [year,month]=next.month.split('-').map(Number)
        const last=new Date(year,month,0).getDate()
        next.start_date=`${year}-${String(month).padStart(2,'0')}-01`
        next.end_date=`${year}-${String(month).padStart(2,'0')}-${String(last).padStart(2,'0')}`
      }
    }
    setForm(next)
  }

  async function create(){
    try{
      setError('');setMessage('')
      const errors={}
      if(!form.name.trim())errors.name='Review period name is required.'
      if(!form.month)errors.month='Review month is required.'
      if(!form.start_date)errors.start_date='Start date is required.'
      if(!form.end_date)errors.end_date='End date is required.'
      if(form.start_date&&form.end_date&&form.start_date>form.end_date)errors.end_date='End date must be on or after the start date.'
      if(!allowedMonth)errors.month=`${typeLabel[form.review_type]} reviews cannot be created for this month.`
      if(Object.keys(errors).length){setFieldErrors(errors);setError('Complete the required fields highlighted in red.');return}
      setFieldErrors({})
      await api.post('/kpi/cycles',form)
      setShow(false);setMessage('Review period created.');load()
    }catch(e){setError(getError(e))}
  }
  async function generateCurrent(){
    try{
      setError('');setMessage('')
      const {data}=await api.post('/kpi/cycles/auto-generate')
      const created=data.created||[]
      setMessage(created.length?`Created ${created.length} current review period${created.length===1?'':'s'}: ${created.join(', ')}`:'All required current review periods already exist.')
      load()
    }catch(e){setError(getError(e))}
  }
  async function changeStatus(id,status){try{await api.patch(`/kpi/cycles/${id}`,{status});load()}catch(e){setError(getError(e))}}
  async function toggleLock(id,is_locked){try{await api.patch(`/kpi/cycles/${id}`,{is_locked});load()}catch(e){setError(getError(e))}}

  return <>
    <PageHeader title="KPI Review Periods" subtitle="Manage Monthly, Quarterly, Half-Yearly and Annual reviews using the April–March financial year." actions={<div className="responsive-actions"><button className="secondary" onClick={generateCurrent}><CalendarPlus size={16}/>Generate Current Periods</button><button className="primary" onClick={()=>setShow(!show)}><Plus size={16}/>Create Review Period</button></div>}/>
    <ErrorBox error={error}/>
    {message?<div className="success-box" style={{marginBottom:'12px'}}>{message}</div>:null}
    <div className="helper-strip" style={{marginBottom:'14px'}}><strong>Financial-year schedule:</strong> Q1 ends June · Q2 and H1 end September · Q3 ends December · Q4, H2 and Annual end March. Monthly reviews remain available every month.</div>
    {show?<Card><div className="form-grid four">
      <label>Review type<select value={form.review_type} onChange={e=>updatePeriod({review_type:e.target.value})}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-Yearly</option><option value="annual">Annual</option></select></label>
      <label>Review month <span className="required-mark">*</span><input className={fieldErrors.month?'field-invalid':''} type="date" value={form.month} onChange={e=>{updatePeriod({month:e.target.value});setFieldErrors(x=>({...x,month:''}))}}/>{fieldErrors.month?<span className="field-error">{fieldErrors.month}</span>:null}</label>
      <label>Financial year<input value={form.financial_year} disabled/></label>
      <label>Period label<input value={form.period_label} disabled/></label>
      <label className="span-2">Name <span className="required-mark">*</span><input className={fieldErrors.name?'field-invalid':''} value={form.name} onChange={e=>{setForm({...form,name:e.target.value});setFieldErrors(x=>({...x,name:''}))}}/>{fieldErrors.name?<span className="field-error">{fieldErrors.name}</span>:null}</label>
      <label>Start date <span className="required-mark">*</span><input className={fieldErrors.start_date?'field-invalid':''} type="date" value={form.start_date} onChange={e=>{setForm({...form,start_date:e.target.value});setFieldErrors(x=>({...x,start_date:''}))}} disabled={form.review_type!=='monthly'}/></label>
      <label>End date <span className="required-mark">*</span><input className={fieldErrors.end_date?'field-invalid':''} type="date" value={form.end_date} onChange={e=>{setForm({...form,end_date:e.target.value});setFieldErrors(x=>({...x,end_date:''}))}} disabled={form.review_type!=='monthly'}/></label>
      <label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></label>
      <button className="primary align-end" onClick={create}>Save review period</button>
    </div>{!allowedMonth?<div className="helper-strip" style={{marginTop:'12px'}}>Choose the correct financial-year review month for {typeLabel[form.review_type]}.</div>:null}</Card>:null}
    {!rows?<Loader/>:<Card><div className="table-wrap"><table>
      <thead><tr><th>Review Period</th><th>Type</th><th>Financial Year</th><th>Review Month</th><th>Coverage</th><th>Status</th><th>Change status</th><th>Admin Lock</th></tr></thead>
      <tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.period_label||c.name}</strong><div className="cell-help">{c.name}</div></td><td>{typeLabel[c.review_type]||c.review_type}</td><td>{c.financial_year||'—'}</td><td>{c.month}</td><td>{c.start_date} → {c.end_date}</td><td><Status value={c.status}/></td><td><select value={c.status} onChange={e=>changeStatus(c.id,e.target.value)}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></td><td><label className="inline-check"><input type="checkbox" checked={c.is_locked||false} onChange={e=>toggleLock(c.id,e.target.checked)}/>{c.is_locked?'Locked':'Open'}</label></td></tr>)}</tbody>
    </table></div></Card>}
  </>
}
