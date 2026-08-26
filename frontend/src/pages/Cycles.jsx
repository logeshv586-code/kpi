import {useEffect, useState} from 'react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Status} from '../components/UI'

export default function Cycles() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({name:'September 2026',month:'2026-09-01',start_date:'2026-09-01',end_date:'2026-09-30',status:'upcoming'})
  const [error, setError] = useState('')
  const load = () => api.get('/kpi/cycles').then(r => setRows(r.data)).catch(e => setError(getError(e)))
  useEffect(() => {
    load()
  }, [])

  async function create() {
    try {
      setError('')
      await api.post('/kpi/cycles', form)
      setShow(false)
      load()
    } catch (e) { setError(getError(e)) }
  }
  async function changeStatus(id, status) {
    try {
      await api.patch(`/kpi/cycles/${id}`, {status})
      load()
    } catch (e) { setError(getError(e)) }
  }

  return <>
    <PageHeader title="KPI Cycles" subtitle="Control the monthly KPI period. Closed cycles preserve historical scores." actions={<button className="primary" onClick={() => setShow(!show)}>Create Cycle</button>}/>
    <ErrorBox error={error}/>
    {show ? <Card><div className="form-grid">
      <label>Name<input value={form.name} onChange={e => setForm({...form,name:e.target.value})}/></label>
      <label>Month<input type="date" value={form.month} onChange={e => setForm({...form,month:e.target.value})}/></label>
      <label>Start date<input type="date" value={form.start_date} onChange={e => setForm({...form,start_date:e.target.value})}/></label>
      <label>End date<input type="date" value={form.end_date} onChange={e => setForm({...form,end_date:e.target.value})}/></label>
      <label>Status<select value={form.status} onChange={e => setForm({...form,status:e.target.value})}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></label>
      <button className="primary align-end" onClick={create}>Save cycle</button>
    </div></Card> : null}
    {!rows ? <Loader/> : <Card><div className="table-wrap"><table>
      <thead><tr><th>Cycle</th><th>Month</th><th>Start</th><th>End</th><th>Status</th><th>Change status</th></tr></thead>
      <tbody>{rows.map(c => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.month}</td><td>{c.start_date}</td><td>{c.end_date}</td><td><Status value={c.status}/></td><td><select value={c.status} onChange={e => changeStatus(c.id,e.target.value)}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></td></tr>)}</tbody>
    </table></div></Card>}
  </>
}
