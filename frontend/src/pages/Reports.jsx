import {useEffect, useMemo, useState} from 'react'
import {Download} from 'lucide-react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Score} from '../components/UI'

export default function Reports() {
  const [data, setData] = useState(null)
  const [division, setDivision] = useState('All')
  const [error, setError] = useState('')
  useEffect(() => { api.get('/dashboard/monthly-matrix').then(r => setData(r.data)).catch(e => setError(getError(e))) }, [])
  const divisions = useMemo(() => ['All', ...new Set((data?.rows || []).map(r => r.division))], [data])
  const rows = useMemo(() => (data?.rows || []).filter(r => division === 'All' || r.division === division), [data,division])

  function exportCsv() {
    if (!data) return
    const head = ['Employee','Division',...data.months,'Average']
    const lines = [head.join(','), ...rows.map(r => {
      const values = data.months.map(m => r.scores[m] ?? '')
      const numeric = values.filter(x => x !== '').map(Number)
      const avg = numeric.length ? (numeric.reduce((a,b)=>a+b,0)/numeric.length).toFixed(1) : ''
      return [r.employee,r.division,...values,avg].map(x => `"${String(x).replaceAll('"','""')}"`).join(',')
    })]
    const blob = new Blob([lines.join('\n')], {type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='kpi-monthly-summary.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return <>
    <PageHeader title="Reports" subtitle="Multi-month organization summary with employee averages and CSV export." actions={<><select value={division} onChange={e => setDivision(e.target.value)}>{divisions.map(d => <option key={d}>{d}</option>)}</select><button className="secondary" onClick={exportCsv}><Download size={16}/>Export CSV</button></>}/>
    <ErrorBox error={error}/>
    {!data ? <Loader/> : <Card><div className="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Division</th>{data.months.map(m => <th key={m}>{m}</th>)}<th>Average</th></tr></thead>
      <tbody>{rows.map(r => {
        const vals = data.months.map(m => r.scores[m]).filter(x => x != null)
        const avg = vals.length ? vals.reduce((a,b) => a+b,0)/vals.length : 0
        return <tr key={r.user_id}><td><strong>{r.employee}</strong></td><td>{r.division}</td>{data.months.map(m => <td key={m}>{r.scores[m] != null ? <Score value={r.scores[m]}/> : <span className="muted">—</span>}</td>)}<td><Score value={avg}/></td></tr>
      })}</tbody>
    </table></div></Card>}
  </>
}
