import {useEffect, useState} from 'react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Status} from '../components/UI'

export default function Cycles() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({name:'September 2026',month:'2026-09-01',start_date:'2026-09-01',end_date:'2026-09-30',status:'upcoming'})
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const load = () => api.get('/kpi/cycles').then(r => setRows(r.data)).catch(e => setError(getError(e)))
  useEffect(() => {
    load()
  }, [])

  async function create() {
    try {
      setError('')
      const errors = {}
      if (!form.name.trim()) errors.name = 'Cycle name is required.'
      if (!form.month) errors.month = 'Month is required.'
      if (!form.start_date) errors.start_date = 'Start date is required.'
      if (!form.end_date) errors.end_date = 'End date is required.'
      if (form.start_date && form.end_date && form.start_date > form.end_date) errors.end_date = 'End date must be on or after the start date.'
      if (Object.keys(errors).length) { setFieldErrors(errors); setError('Complete the required fields highlighted in red.'); return }
      setFieldErrors({})
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
  
  async function toggleLock(id, is_locked) {
    try {
      await api.patch(`/kpi/cycles/${id}`, {is_locked})
      load()
    } catch (e) { setError(getError(e)) }
  }

  return <>
    <PageHeader title="KPI Cycles" subtitle="Control the monthly KPI period. Closed cycles preserve historical scores." actions={<button className="primary" onClick={() => setShow(!show)}>Create Cycle</button>}/>
    <ErrorBox error={error}/>
    {show ? <Card><div className="form-grid">
      <label>Name <span className="required-mark">*</span><input className={fieldErrors.name?'field-invalid':''} aria-invalid={Boolean(fieldErrors.name)} value={form.name} onChange={e => {setForm({...form,name:e.target.value});setFieldErrors(x=>({...x,name:''}))}}/>{fieldErrors.name?<span className="field-error">{fieldErrors.name}</span>:null}</label>
      <label>Month <span className="required-mark">*</span><input className={fieldErrors.month?'field-invalid':''} aria-invalid={Boolean(fieldErrors.month)} type="date" value={form.month} onChange={e => {setForm({...form,month:e.target.value});setFieldErrors(x=>({...x,month:''}))}}/>{fieldErrors.month?<span className="field-error">{fieldErrors.month}</span>:null}</label>
      <label>Start date <span className="required-mark">*</span><input className={fieldErrors.start_date?'field-invalid':''} aria-invalid={Boolean(fieldErrors.start_date)} type="date" value={form.start_date} onChange={e => {setForm({...form,start_date:e.target.value});setFieldErrors(x=>({...x,start_date:''}))}}/>{fieldErrors.start_date?<span className="field-error">{fieldErrors.start_date}</span>:null}</label>
      <label>End date <span className="required-mark">*</span><input className={fieldErrors.end_date?'field-invalid':''} aria-invalid={Boolean(fieldErrors.end_date)} type="date" value={form.end_date} onChange={e => {setForm({...form,end_date:e.target.value});setFieldErrors(x=>({...x,end_date:''}))}}/>{fieldErrors.end_date?<span className="field-error">{fieldErrors.end_date}</span>:null}</label>
      <label>Status<select value={form.status} onChange={e => setForm({...form,status:e.target.value})}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></label>
      <button className="primary align-end" onClick={create}>Save cycle</button>
    </div></Card> : null}
    {!rows ? <Loader/> : <Card><div className="table-wrap"><table>
      <thead><tr><th>Cycle</th><th>Month</th><th>Start</th><th>End</th><th>Status</th><th>Change status</th><th>Admin Lock</th></tr></thead>
      <tbody>{rows.map(c => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.month}</td><td>{c.start_date}</td><td>{c.end_date}</td><td><Status value={c.status}/></td><td><select value={c.status} onChange={e => changeStatus(c.id,e.target.value)}><option value="upcoming">Upcoming</option><option value="running">Running</option><option value="closed">Closed</option></select></td><td><label style={{display:'flex',gap:'8px',alignItems:'center',cursor:'pointer'}}><input type="checkbox" checked={c.is_locked || false} onChange={e => toggleLock(c.id, e.target.checked)}/> {c.is_locked ? 'Locked' : 'Open'}</label></td></tr>)}</tbody>
    </table></div></Card>}
  </>
}
