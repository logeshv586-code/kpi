import {useEffect,useState} from 'react'
import {Download} from 'lucide-react'
import {Link} from 'react-router-dom'
import {api,downloadApiFile,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,Empty,ErrorBox,Loader,PageHeader,Score,Status} from '../components/UI'
import {sortAssignments} from '../lib/sorting'

export default function MyKpi(){
  const {user}=useAuth(),[rows,setRows]=useState(null),[error,setError]=useState(''),[downloading,setDownloading]=useState(null)
  useEffect(()=>{api.get('/kpi/my').then(r=>setRows(sortAssignments(r.data))).catch(e=>setError(getError(e)))},[])
  const subtitle=['superadmin','hr'].includes(user.role)?'All monthly KPI records and their latest calculated/final scores.':user.role==='manager'?'Your KPI plus direct-report monthly KPI records.':'Your monthly KPI summaries, completion progress and final scores.'
  async function pdf(a){setDownloading(a.id);setError('');try{await downloadApiFile(`/kpi/assignments/${a.id}/pdf`,`KPI_${a.cycle}.pdf`)}catch(e){setError(getError(e))}finally{setDownloading(null)}}
  return <><PageHeader title="KPI" subtitle={subtitle}/><ErrorBox error={error}/>{!rows?<Loader/>:rows.length===0?<Empty text="No KPI assignments yet."/>:<div className="stack">{rows.map(a=><Card key={a.id}><div className="summary-row"><div><div className="eyebrow">{a.cycle}</div><h3>{a.employee} · {a.template.name}</h3><div className="muted">{a.template.kras.length} KRAs · Maximum 100 marks</div><div className="assignment-progress"><span>Form completion <b>{a.progress_percent||0}%</b></span><div className="bar"><i style={{width:`${a.progress_percent||0}%`}}/></div></div></div><div className="summary-actions"><Status value={a.status}/><Score value={a.final_score??a.manager_score??a.calculated_score}/><button className="secondary" disabled={downloading===a.id} onClick={()=>pdf(a)}><Download size={15}/>{downloading===a.id?'Preparing...':'Download PDF'}</button><Link className="secondary" to={`/kpi-input?assignment=${a.id}`}>{a.status==='finalized'?'View':'Open KPI'}</Link></div></div><div className="kra-bars">{a.template.kras.map(k=><div key={k.id}><span>{k.name}</span><strong>{k.weight}</strong><div className="bar"><i style={{width:`${k.weight}%`}}/></div></div>)}</div></Card>)}</div>}</>
}
