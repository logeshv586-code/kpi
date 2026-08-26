import {useEffect, useMemo, useState} from 'react'
import {Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, PageHeader, Score} from '../components/UI'
import {sortUsers} from '../lib/sorting'

export default function KpiDashboard(){
  const {user}=useAuth(),[people,setPeople]=useState([]),[selected,setSelected]=useState(user.id),[history,setHistory]=useState([]),[summary,setSummary]=useState(null),[breakdown,setBreakdown]=useState(null),[bands,setBands]=useState([]),[error,setError]=useState('')
  useEffect(()=>{
    Promise.all([api.get('/dashboard/summary'),api.get('/dashboard/rating-bands')]).then(([s,b])=>{setSummary(s.data);setBands(b.data)}).catch(e=>setError(getError(e)))
    if(['superadmin','hr'].includes(user.role)) api.get('/admin/users').then(r=>{const employees=sortUsers(r.data.filter(x=>x.role!=='superadmin'));setPeople(employees);if(employees.length&&!employees.some(x=>x.id===selected))setSelected(employees[0].id)}).catch(e=>setError(getError(e)))
    else if(user.role==='manager') api.get('/kpi/my').then(r=>{const map=new Map();r.data.forEach(a=>map.set(a.employee_id,{id:a.employee_id,name:a.employee}));const list=[...map.values()];setPeople(list);if(!list.some(x=>x.id===selected))setSelected(user.id)}).catch(e=>setError(getError(e)))
    else setPeople([{id:user.id,name:user.name}])
  },[user.id,user.role])
  useEffect(()=>{if(!selected)return;Promise.all([api.get(`/dashboard/history/${selected}`),api.get(`/dashboard/kra-breakdown/${selected}`)]).then(([h,b])=>{setHistory(h.data);setBreakdown(b.data)}).catch(e=>setError(getError(e)))},[selected])
  const kpiTrend=useMemo(()=>history.map(x=>({...x,score:Number(x.score||0)})),[history])
  const selectedName=people.find(x=>Number(x.id)===Number(selected))?.name||user.name
  const latest=kpiTrend[kpiTrend.length-1]?.score||0
  const rating=(bands||[]).sort((a,b)=>b.min-a.min).find(x=>latest>=Number(x.min||0))?.label||'Not rated'
  return <>
    <PageHeader title="KPI Dashboard" subtitle="Employee history, current KRA achievement, division comparison and configurable performance rating." actions={people.length>1?<select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>:null}/><ErrorBox error={error}/>
    <div className="metric-grid compact"><Card><span>Employee</span><strong className="small-metric">{selectedName}</strong></Card><Card><span>Latest score</span><strong>{latest.toFixed(1)}</strong></Card><Card><span>Current rating</span><strong className="small-metric">{rating}</strong></Card><Card><span>Latest cycle</span><strong className="small-metric">{breakdown?.cycle||'—'}</strong></Card></div>
    <div className="grid-2"><Card><h3>{selectedName} · score history</h3><div className="chart"><ResponsiveContainer><LineChart data={kpiTrend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month"/><YAxis domain={[0,100]}/><Tooltip/><Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={3} dot={{r:4}}/></LineChart></ResponsiveContainer></div></Card><Card><h3>Current KRA performance · {breakdown?.cycle||'No cycle'}</h3><div className="chart"><ResponsiveContainer><BarChart data={breakdown?.rows||[]} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[0,100]}/><YAxis type="category" dataKey="kra" width={180}/><Tooltip/><Bar dataKey="percent" fill="#2563eb" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Card></div>
    <div className="grid-2"><Card><h3>Division score comparison</h3><div className="chart"><ResponsiveContainer><BarChart data={summary?.division_scores||[]} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[0,100]}/><YAxis type="category" dataKey="name" width={180}/><Tooltip/><Bar dataKey="score" fill="#16a34a" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Card><Card><h3>KRA score breakdown</h3><div className="table-wrap"><table><thead><tr><th>KRA</th><th>Earned</th><th>Max</th><th>Achievement</th></tr></thead><tbody>{(breakdown?.rows||[]).map(r=><tr key={r.kra}><td><strong>{r.kra}</strong></td><td><strong>{Number(r.score||0).toFixed(1)}</strong></td><td>{r.weight}</td><td><div className="mini-progress"><span>{r.percent}%</span><div className="bar"><i style={{width:`${Math.min(r.percent,100)}%`}}/></div></div></td></tr>)}</tbody></table></div></Card></div>
    <Card><h3>Scoring guide</h3><div className="rating-grid dynamic">{bands.map(b=><div key={`${b.min}-${b.label}`}><strong>{b.min}+</strong><span>{b.label}</span></div>)}</div></Card>
  </>
}
