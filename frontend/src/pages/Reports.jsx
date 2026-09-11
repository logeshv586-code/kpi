import {useEffect,useMemo,useState} from 'react'
import {Award,BarChart2,CheckCircle2,Clock3,Download,TrendingUp,UserCheck,Users} from 'lucide-react'
import {api,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,ErrorBox,Loader,PageHeader,Score} from '../components/UI'
import {chooseDefaultReportOption,currentFinancialYear} from '../lib/reviewPeriodSelection'

const typeLabel={monthly:'Monthly',quarterly:'Quarterly',half_yearly:'Half-Yearly',annual:'Annual'}
const typeOrder={monthly:0,quarterly:1,half_yearly:2,annual:3}
function getRatingBand(score){if(score>=90)return'Outstanding';if(score>=80)return'Very Good';if(score>=70)return'Good';if(score>=60)return'Needs Improvement';return'Improvement Required'}
const whole=value=>Math.round(Number(value||0))

export default function Reports(){
  const{user}=useAuth()
  const[data,setData]=useState(null),[pending,setPending]=useState(null)
  const[reviewType,setReviewType]=useState('monthly'),[financialYear,setFinancialYear]=useState(''),[periodKey,setPeriodKey]=useState(''),[department,setDepartment]=useState('All'),[error,setError]=useState('')

  const isOrgAdmin=['superadmin','hr'].includes(user?.role)
  const title=isOrgAdmin?'Performance Reports':(user?.role==='manager'||user?.is_reporting_manager)?'Team Performance Reports':'My Performance Report'
  const subtitle='View whole-number KPI results by Monthly, Quarterly, Half-Yearly or Annual financial-year review.'

  useEffect(()=>{Promise.all([api.get('/dashboard/review-matrix'),api.get('/kpi/pending-summary')]).then(([matrix,status])=>{setData(matrix.data);setPending(status.data)}).catch(e=>setError(getError(e)))},[])

  const periods=useMemo(()=>[...(data?.periods||[])].sort((a,b)=>String(a.month).localeCompare(String(b.month))||(typeOrder[a.review_type]??99)-(typeOrder[b.review_type]??99)),[data])
  const financialYears=useMemo(()=>[...new Set(periods.map(p=>p.financial_year).filter(Boolean))].sort().reverse(),[periods])
  useEffect(()=>{
    if(financialYear||!financialYears.length)return
    const currentFy=currentFinancialYear()
    setFinancialYear(financialYears.includes(currentFy)?currentFy:financialYears[0])
  },[financialYears,financialYear])
  const availableTypes = ['monthly', 'quarterly', 'half_yearly', 'annual']

  const quarterMonths = {
    'Q1 (Apr–Jun)': [4, 5, 6],
    'Q2 (Jul–Sep)': [7, 8, 9],
    'Q3 (Oct–Dec)': [10, 11, 12],
    'Q4 (Jan–Mar)': [1, 2, 3]
  }

  const halfYearMonths = {
    'H1 (Apr–Sep)': [4, 5, 6, 7, 8, 9],
    'H2 (Oct–Mar)': [10, 11, 12, 1, 2, 3]
  }

  const filteredPeriods = useMemo(() => {
    return periods.filter(p => !financialYear || p.financial_year === financialYear)
  }, [periods, financialYear])

  const periodOptions = useMemo(() => {
    if (reviewType === 'monthly') {
      const monthPeriods = filteredPeriods.filter(p => p.review_type === 'monthly')
      return monthPeriods.map(p => ({
        key: p.key,
        label: p.label || p.name,
        keys: [p.key],
        status: p.status,
        month: p.month,
      }))
    }

    if (reviewType === 'quarterly') {
      return Object.entries(quarterMonths).map(([qLabel, months]) => {
        const matching = filteredPeriods.filter(p => {
          const m = Number(String(p.month || '').slice(5, 7))
          if (p.review_type === 'quarterly') {
            return (qLabel.startsWith('Q1') && m === 6) ||
                   (qLabel.startsWith('Q2') && m === 9) ||
                   (qLabel.startsWith('Q3') && m === 12) ||
                   (qLabel.startsWith('Q4') && m === 3)
          }
          return months.includes(m)
        })
        return {
          key: qLabel,
          label: `${qLabel} · ${financialYear || 'FY'}`,
          keys: matching.map(p => p.key),
          month: matching[0]?.month,
          status: matching.some(p => p.status === 'running') ? 'running' : 'upcoming'
        }
      })
    }

    if (reviewType === 'half_yearly') {
      return Object.entries(halfYearMonths).map(([hLabel, months]) => {
        const matching = filteredPeriods.filter(p => {
          const m = Number(String(p.month || '').slice(5, 7))
          if (p.review_type === 'half_yearly') {
            return (hLabel.startsWith('H1') && m === 9) ||
                   (hLabel.startsWith('H2') && m === 3)
          }
          return months.includes(m)
        })
        return {
          key: hLabel,
          label: `${hLabel} · ${financialYear || 'FY'}`,
          keys: matching.map(p => p.key),
          month: matching[0]?.month,
          status: matching.some(p => p.status === 'running') ? 'running' : 'upcoming'
        }
      })
    }

    if (reviewType === 'annual') {
      return [{
        key: 'annual_full',
        label: `Annual (Apr–Mar) · ${financialYear || 'FY'}`,
        keys: filteredPeriods.map(p => p.key),
        status: filteredPeriods.some(p => p.status === 'running') ? 'running' : 'upcoming'
      }]
    }

    return []
  }, [reviewType, filteredPeriods, financialYear])

  useEffect(() => {
    if (!periodOptions.length) return
    if (!periodKey || (periodKey !== 'all' && !periodOptions.some(p => p.key === periodKey))) {
      const currentFy=currentFinancialYear()
      const match=financialYear===currentFy
        ? chooseDefaultReportOption(reviewType,periodOptions)
        : periodOptions[periodOptions.length-1]
      setPeriodKey(match ? match.key : 'all')
    }
  }, [periodOptions, periodKey, reviewType, financialYear])

  const selectedKeys = useMemo(() => {
    if (periodKey === 'all') {
      if (reviewType === 'monthly') {
        return new Set(filteredPeriods.filter(p => p.review_type === 'monthly').map(p => p.key))
      }
      const allOptionKeys = periodOptions.flatMap(opt => opt.keys)
      return new Set(allOptionKeys)
    }
    const found = periodOptions.find(p => p.key === periodKey)
    return new Set(found ? found.keys : [])
  }, [periodKey, reviewType, filteredPeriods, periodOptions])

  const selectedPeriodLabel = useMemo(() => {
    if (periodKey === 'all') {
      return `All ${typeLabel[reviewType] || reviewType} · ${financialYear || 'All FY'}`
    }
    const found = periodOptions.find(p => p.key === periodKey)
    return found ? found.label : 'Selected period'
  }, [periodKey, reviewType, financialYear, periodOptions])

  const departments=useMemo(()=>['All',...new Set((data?.rows||[]).map(r=>r.department).filter(Boolean))].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b)),[data])
  useEffect(()=>{if(department!=='All'&&!departments.includes(department))setDepartment('All')},[departments,department])
  const departmentLabel=department==='All'?'All Departments':department

  const rows=useMemo(()=>{
    return(data?.rows||[]).filter(r=>department==='All'||r.department===department).map(r=>{
      const values=Object.entries(r.scores||{}).filter(([key,value])=>selectedKeys.has(key)&&value!==null&&value!==undefined).map(([,value])=>Number(value)).filter(Number.isFinite)
      const empValues=Object.entries(r.employee_scores||{}).filter(([key,value])=>selectedKeys.has(key)&&value!==null&&value!==undefined).map(([,value])=>Number(value)).filter(Number.isFinite)
      const mgrValues=Object.entries(r.manager_scores||{}).filter(([key,value])=>selectedKeys.has(key)&&value!==null&&value!==undefined).map(([,value])=>Number(value)).filter(Number.isFinite)
      const thresholdIssues=selectedKeys.size
        ? Object.entries(r.threshold_failures||{}).filter(([key])=>selectedKeys.has(key)).flatMap(([,issues])=>issues||[])
        : Object.values(r.threshold_failures||{}).flatMap(issues=>issues||[])
      let score=values.length?whole(values.reduce((s,v)=>s+v,0)/values.length):null
      if(thresholdIssues.length>0&&score!==null){
        score=0
      }
      const empScore=empValues.length?whole(empValues.reduce((s,v)=>s+v,0)/empValues.length):null
      const mgrScore=mgrValues.length?whole(mgrValues.reduce((s,v)=>s+v,0)/mgrValues.length):null
      const ratingBand=score!=null?getRatingBand(score):'Not Evaluated'
      return{...r,display_score:score,display_emp_score:empScore,display_mgr_score:mgrScore,display_band:ratingBand,display_rating:thresholdIssues.length?`${ratingBand} - ${thresholdIssues.join(' | ')}`:ratingBand,threshold_issues:thresholdIssues}
    }).filter(r=>r.display_score!==null||r.display_emp_score!==null||r.display_mgr_score!==null)
  },[data,department,selectedKeys])

  const metrics=useMemo(()=>{
    const valid=rows.filter(r=>r.display_score!=null)
    if(!valid.length)return{avg:0,highCount:0,total:0,topDepartment:'N/A'}
    const avg=whole(valid.reduce((s,r)=>s+Number(r.display_score),0)/valid.length),highCount=valid.filter(r=>Number(r.display_score)>=90).length,grouped={}
    valid.forEach(r=>{if(!r.department)return;if(!grouped[r.department])grouped[r.department]={total:0,count:0};grouped[r.department].total+=Number(r.display_score);grouped[r.department].count+=1})
    let topDepartment='N/A',top=-1;Object.entries(grouped).forEach(([name,value])=>{const score=value.total/value.count;if(score>top){top=score;topDepartment=name}})
    return{avg,highCount,total:valid.length,topDepartment}
  },[rows])

  function exportCsv(){
    if(!rows.length)return
    const head=['Employee','Email','Financial Year','Review Type','Period','Department','Designation','Reports To','Employee Score','Manager Score','Final Score','Rating Band','Threshold Issues']
    const lines=[head.join(','),...rows.map(r=>[r.employee,r.email||'',financialYear,typeLabel[reviewType]||reviewType,selectedPeriodLabel,r.department||'',r.designation||'',r.manager||'',r.display_emp_score??'N/A',r.display_mgr_score??'N/A',r.display_score??'N/A',r.display_rating,r.threshold_issues.join(' | ')||'None'].map(x=>`"${String(x).replaceAll('"','""')}"`).join(','))]
    const departmentSlug=(department==='All'?'all-departments':department).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
    const blob=new Blob([lines.join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url
    a.download=`kpi-${departmentSlug}-${reviewType}-${financialYear||'report'}`.toLowerCase().replace(/\s+/g,'-')+'.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  function bandClass(band){if(band==='Outstanding')return'status-finalized';if(band==='Very Good'||band==='Good')return'status-manager_reviewed';if(band==='Needs Improvement')return'status-submitted';return'status-draft'}

  return<>
    <PageHeader title={title} subtitle={subtitle} actions={<div className="report-actions responsive-actions"><select value={financialYear} onChange={e=>{setFinancialYear(e.target.value);setPeriodKey('')}} aria-label="Financial year">{financialYears.map(fy=><option key={fy} value={fy}>{fy}</option>)}</select><select value={reviewType} onChange={e=>{setReviewType(e.target.value);setPeriodKey('')}} aria-label="Review type">{availableTypes.map(type=><option key={type} value={type}>{typeLabel[type]||type}</option>)}</select><select value={periodKey} onChange={e=>setPeriodKey(e.target.value)} aria-label="Review period"><option value="all">All periods</option>{periodOptions.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}</select><select value={department} onChange={e=>setDepartment(e.target.value)} aria-label="Department"><option value="All">All Departments</option>{departments.filter(d=>d!=='All').map(d=><option key={d} value={d}>{d}</option>)}</select><button className="secondary" disabled={!rows.length} onClick={exportCsv}><Download size={16}/>Download Report</button></div>}/>
    <ErrorBox error={error}/>
    {!data?<Loader/>:<>
      <div className="helper-strip" style={{marginBottom:'14px'}}><strong>Report:</strong> {selectedPeriodLabel} · <strong>Department:</strong> {departmentLabel} · April–March financial year · scores rounded to whole integers.</div>
      {pending?<div className="metric-grid compact pending-metrics" style={{marginBottom:'16px'}}>
        <Card><div className="metric-label"><Clock3 size={16}/><span>Staff Pending</span></div><strong className="small-metric">{pending.pending_staff||0}</strong><div className="cell-help">Not started / draft</div></Card>
        <Card><div className="metric-label"><UserCheck size={16}/><span>Manager Review Pending</span></div><strong className="small-metric">{pending.pending_manager_review||0}</strong><div className="cell-help">Staff submitted</div></Card>
        <Card><div className="metric-label"><CheckCircle2 size={16}/><span>Ready for HR</span></div><strong className="small-metric">{pending.ready_for_hr||0}</strong><div className="cell-help">Manager reviewed</div></Card>
        <Card><div className="metric-label"><CheckCircle2 size={16}/><span>Finalized</span></div><strong className="small-metric">{pending.finalized||0}</strong><div className="cell-help">HR completed</div></Card>
      </div>:null}
      <div className="metric-grid compact" style={{marginBottom:'16px'}}>
        <Card><div className="metric-label"><BarChart2 size={16}/><span>Average Score</span></div><strong className="small-metric">{metrics.avg}</strong></Card>
        <Card><div className="metric-label"><Award size={16}/><span>High Performers (≥90)</span></div><strong className="small-metric">{metrics.highCount}</strong></Card>
        <Card><div className="metric-label"><Users size={16}/><span>Evaluated Records</span></div><strong className="small-metric">{metrics.total}</strong></Card>
        <Card><div className="metric-label"><TrendingUp size={16}/><span>Top Department</span></div><strong className="small-metric compact-name">{metrics.topDepartment}</strong></Card>
      </div>
      <Card><div className="report-table-title">Performance Matrix: <span>{selectedPeriodLabel} · {departmentLabel}</span></div><div className="table-wrap"><table className="responsive-data-table"><thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Reports To</th><th>Employee Score</th><th>Manager Score</th><th>Final Score</th><th>Rating Band</th><th>Threshold Issues</th></tr></thead><tbody>{rows.map(r=><tr key={r.user_id}><td data-label="Employee"><strong>{r.employee}</strong><div className="cell-help">{r.email}</div></td><td data-label="Department">{r.department||'—'}</td><td data-label="Designation">{r.designation||'—'}</td><td data-label="Reports To">{r.manager||'—'}</td><td data-label="Employee Score">{r.display_emp_score!=null?<Score value={r.display_emp_score}/>:<span className="muted">N/A</span>}</td><td data-label="Manager Score">{r.display_mgr_score!=null?<Score value={r.display_mgr_score}/>:<span className="muted">N/A</span>}</td><td data-label="Final Score">{r.display_score!=null?<Score value={r.display_score}/>:<span className="muted">N/A</span>}</td><td data-label="Rating"><span className={`status-badge ${bandClass(r.display_band)}`}>{r.display_rating}</span></td><td data-label="Threshold Issues">{r.threshold_issues.length?<div className="stack-tight">{r.threshold_issues.map((issue,index)=><div key={index} className="threshold-not-achieved">{issue}</div>)}</div>:<span className="muted">None</span>}</td></tr>)}</tbody></table></div>{!rows.length?<div className="empty">No performance data found for this review period.</div>:null}</Card>
    </>}
  </>
}
