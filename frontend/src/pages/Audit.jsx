import {useEffect, useState} from 'react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader} from '../components/UI'

export default function Audit() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/audit-logs').then(r => setRows(r.data)).catch(e => setError(getError(e))) }, [])
  return <>
    <PageHeader title="Audit Logs" subtitle="Trace template, assignment, employee submission, manager review, HR finalization and reopening actions."/>
    <ErrorBox error={error}/>
    {!rows ? <Loader/> : <Card><div className="table-wrap"><table>
      <thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.actor}</td><td>{r.action.replaceAll('_',' ')}</td><td>{r.entity_type} #{r.entity_id || ''}</td><td><code>{r.details ? JSON.stringify(r.details) : '—'}</code></td></tr>)}</tbody>
    </table></div></Card>}
  </>
}
