import {useEffect, useMemo, useState} from 'react'
import {Award, BarChart2, CalendarRange, Download, TrendingUp, Users} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Score} from '../components/UI'

const monthOrder={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}

function getRatingBand(score){
  if(score>=90)return'Outstanding'
  if(score>=80)return'Very Good'
  if(score>=70)return'Good'
  if(score>=60)return'Needs Improvement'
  return'Improvement Required'
}
function roundOne(value){return Math.round(Number(value||0)*10)/10}
function monthKey(label){
  const [mon,year]=String(label||'').trim().split(/\s+/)
  return Number(year||0)*12+(monthOrder[mon]??0)
}

export default function Reports(){
  const{user}=useAuth()
  const[data,setData]=useState(null)
  const[department,setDepartment]=useState('All')
  const[fromMonth,setFromMonth]=useState('')
  const[toMonth,setToMonth]=useState('')
  const[draftFrom,setDraftFrom]=useState('')
  const[draftTo,setDraftTo]=useState('')
  const[showRangeModal,setShowRangeModal]=useState(false)
  const[error,setError]=useState('')

  const title=['superadmin','hr'].includes(user?.role)?'Performance Reports':user?.role==='manager'?'Team Performance Reports':'My Performance Report'
  const subtitle='Choose a From month and To month to view performance only for that selected period.'

  useEffect(()=>{api.get('/dashboard/monthly-matrix').then(r=>setData(r.data)).catch(e=>setError(getError(e)))},[])

  const availableMonths=useMemo(()=>[...(data?.months||[])].sort((a,b)=>monthKey(a)-monthKey(b)),[data])
  const hasAvailableMonths=availableMonths.length>0
  const departments=useMemo(()=>['All',...new Set((data?.rows||[]).map(r=>r.department).filter(Boolean))].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b)),[data])

  useEffect(()=>{
    if(!availableMonths.length)return
    setFromMonth(current=>current&&availableMonths.includes(current)?current:availableMonths[0])
    setToMonth(current=>current&&availableMonths.includes(current)?current:availableMonths[availableMonths.length-1])
  },[availableMonths])

  const selectedMonths=useMemo(()=>{
    if(!fromMonth||!toMonth)return[]
    const start=monthKey(fromMonth),end=monthKey(toMonth)
    return availableMonths.filter(m=>monthKey(m)>=Math.min(start,end)&&monthKey(m)<=Math.max(start,end))
  },[availableMonths,fromMonth,toMonth])

  const rangeLabel=fromMonth&&toMonth?`${fromMonth} → ${toMonth}`:'Select report range'

  const rows=useMemo(()=>{
    return(data?.rows||[])
      .filter(r=>department==='All'||r.department===department)
      .map(r=>{
        const values=selectedMonths.map(m=>r.scores?.[m]).filter(v=>v!==null&&v!==undefined&&v!=='').map(Number).filter(Number.isFinite)
        const score=values.length?roundOne(values.reduce((s,v)=>s+v,0)/values.length):null
        return{...r,display_score:score,display_band:score!=null?getRatingBand(score):'Not Evaluated'}
      })
  },[data,department,selectedMonths])

  const metrics=useMemo(()=>{
    const valid=rows.filter(r=>r.display_score!=null)
    if(!valid.length)return{avg:0,highCount:0,total:0,topDepartment:'N/A'}
    const avg=roundOne(valid.reduce((s,r)=>s+Number(r.display_score),0)/valid.length)
    const highCount=valid.filter(r=>Number(r.display_score)>=90).length
    const grouped={}
    valid.forEach(r=>{if(!r.department)return;if(!grouped[r.department])grouped[r.department]={total:0,count:0};grouped[r.department].total+=Number(r.display_score);grouped[r.department].count+=1})
    let topDepartment='N/A',top=-1
    Object.entries(grouped).forEach(([name,v])=>{const score=v.total/v.count;if(score>top){top=score;topDepartment=name}})
    return{avg,highCount,total:valid.length,topDepartment}
  },[rows])

  function openRange(){
    if(!hasAvailableMonths){setError('No report months are available yet. Create KPI cycles or performance data first.');return}
    setError('');setDraftFrom(fromMonth);setDraftTo(toMonth);setShowRangeModal(true)
  }
  function applyRange(){
    if(!draftFrom||!draftTo){setError('Select both From month and To month.');return}
    if(monthKey(draftFrom)>monthKey(draftTo)){setError('From month must be before or the same as To month.');return}
    setError('');setFromMonth(draftFrom);setToMonth(draftTo);setShowRangeModal(false)
  }

  function exportCsv(){
    if(!rows.length)return
    const head=['Employee','Email','From Month','To Month','Department','Designation','Score','Rating Band']
    const lines=[head.join(','),...rows.map(r=>[r.employee,r.email||'',fromMonth,toMonth,r.department||'',r.designation||'',r.display_score??'N/A',r.display_band].map(x=>`"${String(x).replaceAll('"','""')}"`).join(','))]
    const blob=new Blob([lines.join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download=`kpi-report-${fromMonth}-to-${toMonth}`.toLowerCase().replace(/\s+/g,'-')+'.csv';a.click();URL.revokeObjectURL(url)
  }
  function bandClass(band){if(band==='Outstanding')return'status-finalized';if(band==='Very Good'||band==='Good')return'status-manager_reviewed';if(band==='Needs Improvement')return'status-submitted';return'status-draft'}

  return<>
    <PageHeader title={title} subtitle={subtitle} actions={<div className="report-actions"><button className="secondary" type="button" onClick={openRange}><CalendarRange size={16}/>{rangeLabel}</button>{departments.length>2?<select value={department} onChange={e=>setDepartment(e.target.value)} aria-label="Department" style={{maxWidth:'200px'}}>{departments.map(d=><option key={d}>{d}</option>)}</select>:null}<button className="secondary" onClick={exportCsv}><Download size={16}/>Export CSV</button></div>}/>
    <ErrorBox error={error}/>
    {!data?<Loader/>:<>
      <div className="helper-strip" style={{marginBottom:'14px'}}><strong>Report period:</strong> {rangeLabel} · {selectedMonths.length} month{selectedMonths.length===1?'':'s'} included.</div>
      <div className="metric-grid compact" style={{marginBottom:'16px'}}>
        <Card><div style={{display:'flex',alignItems:'center',gap:'8px',color:'#64748b'}}><BarChart2 size={16}/><span>Average Score</span></div><strong className="small-metric">{metrics.avg}</strong></Card>
        <Card><div style={{display:'flex',alignItems:'center',gap:'8px',color:'#64748b'}}><Award size={16}/><span>High Performers (≥90)</span></div><strong className="small-metric">{metrics.highCount}</strong></Card>
        <Card><div style={{display:'flex',alignItems:'center',gap:'8px',color:'#64748b'}}><Users size={16}/><span>Evaluated Records</span></div><strong className="small-metric">{metrics.total}</strong></Card>
        <Card><div style={{display:'flex',alignItems:'center',gap:'8px',color:'#64748b'}}><TrendingUp size={16}/><span>Top Department</span></div><strong className="small-metric" style={{fontSize:'1rem'}}>{metrics.topDepartment}</strong></Card>
      </div>
      <Card><div style={{fontSize:'0.9rem',fontWeight:700,color:'#1e293b',marginBottom:'14px'}}>Performance Matrix: <span style={{color:'#2563eb'}}>{rangeLabel}</span></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Report Period</th><th>Score</th><th>Rating Band</th></tr></thead><tbody>{rows.map(r=><tr key={r.user_id}><td><strong>{r.employee}</strong><div className="cell-help">{r.email}</div></td><td>{r.department||'—'}</td><td>{r.designation||'—'}</td><td>{rangeLabel}</td><td>{r.display_score!=null?<Score value={r.display_score}/>:<span className="muted">N/A</span>}</td><td><span className={`status-badge ${bandClass(r.display_band)}`}>{r.display_band}</span></td></tr>)}</tbody></table></div>{!rows.length?<div className="empty">No performance data found for this department and period.</div>:null}</Card>
    </>}

    {showRangeModal?<Modal title="Select report period" onClose={()=>setShowRangeModal(false)} actions={<><button className="secondary" onClick={()=>setShowRangeModal(false)}>Cancel</button><button className="primary" onClick={applyRange} disabled={!draftFrom||!draftTo}>Apply From / To</button></>}>
      <div className="helper-strip" style={{margin:'0 0 16px'}}>Choose the first month and last month. Every available month between them will be included in the report.</div>
      <div className="form-grid report-range-fields"><label>From month<select value={draftFrom} onChange={e=>{const value=e.target.value;setDraftFrom(value);if(draftTo&&monthKey(value)>monthKey(draftTo))setDraftTo(value)}}><option value="" disabled>Select first month</option>{availableMonths.map(m=><option key={m} value={m}>{m}</option>)}</select></label><label>To month<select value={draftTo} onChange={e=>setDraftTo(e.target.value)}><option value="" disabled>Select last month</option>{availableMonths.filter(m=>!draftFrom||monthKey(m)>=monthKey(draftFrom)).map(m=><option key={m} value={m}>{m}</option>)}</select></label></div>
      {draftFrom&&draftTo?<div className="helper-strip" style={{marginTop:'14px'}}><strong>Selected:</strong> {draftFrom} → {draftTo}</div>:null}
    </Modal>:null}
  </>
}
