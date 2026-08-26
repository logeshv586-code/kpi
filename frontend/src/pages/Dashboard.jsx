import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {BarChart3,ClipboardCheck,FileInput} from 'lucide-react'
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis,Pie,PieChart,Cell} from 'recharts'
import {api,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,ErrorBox,Loader,PageHeader} from '../components/UI'

export default function Dashboard(){
  const {user}=useAuth(),[data,setData]=useState(null),[error,setError]=useState('')
  useEffect(()=>{api.get('/dashboard/summary').then(r=>setData(r.data)).catch(e=>setError(getError(e)))},[])
  if(!data)return <><PageHeader title="Overview" subtitle="Organization KPI health and monthly progress"/><ErrorBox error={error}/><Loader/></>
  const pie=Object.entries(data.status_counts||{}).map(([name,value])=>({name:name.replaceAll('_',' '),value}))
  const quick=[]
  if(data.pending?.fill>0||user.role==='employee') quick.push({to:'/kpi-input',icon:FileInput,title:'Fill your KPI',text:`${data.pending?.fill||0} KPI form(s) need your input`})
  if(['manager','hr','superadmin'].includes(user.role)) quick.push({to:'/approvals',icon:ClipboardCheck,title:'Review team KPIs',text:`${user.role==='manager'?data.pending?.review||0:(data.pending?.finalize||0)} item(s) waiting for action`})
  quick.push({to:'/kpi-dashboard',icon:BarChart3,title:'View reports',text:'See monthly trends and performance history'})
  return <><PageHeader title="Overview" subtitle={`Current KPI position${data.current_cycle?` · ${data.current_cycle}`:''}`}/><div className="quick-grid">{quick.map(({to,icon:Icon,title,text})=><Link to={to} className="quick-action" key={to+title}><div className="quick-icon"><Icon size={20}/></div><div><strong>{title}</strong><span>{text}</span></div><b>→</b></Link>)}</div><div className="metric-grid"><Card><span>Total employees</span><strong>{data.total_employees}</strong><small>Active users</small></Card><Card><span>KPI cycles</span><strong>{data.running_cycles}</strong><small>Currently running</small></Card><Card><span>Submission rate</span><strong>{data.submission_rate}%</strong><small>This cycle</small></Card><Card><span>Average KPI score</span><strong>{data.average_score}</strong><small>Across visible records</small></Card></div><div className="grid-2"><Card><h3>Average score by division</h3><div className="chart"><ResponsiveContainer><BarChart data={data.division_scores}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis domain={[0,100]}/><Tooltip/><Bar dataKey="score" fill="#2563eb" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></Card><Card><h3>Submission status</h3><div className="chart"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={2}>{pie.map((_,i)=><Cell key={i} fill={['#2563eb','#16a34a','#f59e0b','#7c3aed','#0f172a'][i%5]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div></Card></div></>
}
