import {useEffect, useMemo, useState} from 'react'
import {Eye, Network, ShieldCheck, Users} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, PageHeader} from '../components/UI'

function PersonNode({node}){
  return <div className={`org-node level-${Math.min(node.hierarchy_level||0,4)}`}>
    <div className="org-person-card">
      <div className="avatar tiny">{node.name?.slice(0,1)}</div>
      <div className="org-person-main">
        <div className="org-person-name"><strong>{node.name}</strong><span className={`status-badge ${node.relation==='direct_report'?'status-manager_reviewed':'status-draft'}`}>{node.relation==='self'?'You':node.relation==='direct_report'?'Direct report':`Level ${node.hierarchy_level}`}</span></div>
        <div className="muted">{node.employee_no} · {node.designation||node.role}</div>
        <div className="cell-help">{node.department||'No department'}{node.manager_name?` · Reports to ${node.manager_name}`:''}</div>
      </div>
      <div className="org-authority">
        {node.can_review?<span title="Immediate manager review authority"><ShieldCheck size={16}/> Review</span>:node.relation!=='self'?<span title="Visible because this employee is below you in the hierarchy"><Eye size={16}/> View</span>:null}
      </div>
    </div>
    {node.children?.length?<div className="org-children">{node.children.map(child=><PersonNode key={child.id} node={child}/>)}</div>:null}
  </div>
}

export default function Hierarchy() {
  const {user}=useAuth()
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  useEffect(()=>{api.get('/kpi/team-tree').then(r=>setData(r.data)).catch(e=>setError(getError(e)))},[])

  const counts=useMemo(()=>{
    const rows=data?.flat||[]
    return{
      total:rows.length,
      direct:rows.filter(x=>x.relation==='direct_report').length,
      descendants:rows.filter(x=>x.relation==='descendant').length,
    }
  },[data])

  return <>
    <PageHeader title="Team Hierarchy" subtitle="Built directly from the Reports To relationship already stored in the employee database. Senior managers can view every level below them; Manager Score authority remains with the immediate reporting manager."/>
    <ErrorBox error={error}/>
    {!data?<Loader/>:<>
      <div className="metric-grid compact" style={{marginBottom:'16px'}}>
        <Card><div className="metric-label"><Users size={16}/><span>Visible people</span></div><strong className="small-metric">{counts.total}</strong></Card>
        <Card><div className="metric-label"><ShieldCheck size={16}/><span>Direct reports</span></div><strong className="small-metric">{counts.direct}</strong></Card>
        <Card><div className="metric-label"><Network size={16}/><span>Lower-level reports</span></div><strong className="small-metric">{counts.descendants}</strong></Card>
      </div>
      <div className="helper-strip" style={{marginBottom:'14px'}}><strong>Visibility rule:</strong> {data.scope==='organization'?'HR/Super Admin can see the full organization.':data.scope==='descendants'?`${user?.name} can see direct reports and every employee recursively below them.`:'No reporting employees are assigned below this account.'} <strong>Approval rule:</strong> only the employee's immediate Reports To manager can submit Manager Score.</div>
      <Card>
        <div className="org-tree-heading"><Network size={18}/><strong>{data.scope==='organization'?'Organization':'My Team'}</strong></div>
        <div className="org-tree">{data.tree?.map(root=><PersonNode key={root.id} node={root}/>)}</div>
        {!data.tree?.length?<div className="empty">No hierarchy records found.</div>:null}
      </Card>
    </>}
  </>
}
