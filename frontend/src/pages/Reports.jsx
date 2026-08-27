import {useEffect, useMemo, useState} from 'react'
import {Award, BarChart2, Calendar, Download, TrendingUp, Users} from 'lucide-react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Score} from '../components/UI'

function getRatingBand(score) {
  if (score >= 90) return 'Outstanding'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Needs Improvement'
  return 'Improvement Required'
}

export default function Reports() {
  const [data, setData] = useState(null)
  const [division, setDivision] = useState('All')
  const [monthFilter, setMonthFilter] = useState('All')
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/dashboard/monthly-matrix')
      .then(r => setData(r.data))
      .catch(e => setError(getError(e)))
  }, [])

  const divisions = useMemo(() => ['All', ...new Set((data?.rows || []).map(r => r.division))], [data])
  const months = useMemo(() => ['All', ...(data?.months || [])], [data])

  const rows = useMemo(() => {
    const raw = (data?.rows || []).filter(r => division === 'All' || r.division === division)
    if (monthFilter === 'All') return raw
    return raw.map(r => {
      const monthScore = r.scores ? r.scores[monthFilter] : undefined
      return {
        ...r,
        display_month: monthFilter,
        month_score: monthScore,
        month_band: monthScore != null ? getRatingBand(monthScore) : 'Not Evaluated'
      }
    })
  }, [data, division, monthFilter])

  // Summary Metrics
  const metrics = useMemo(() => {
    if (!rows.length) return { avg: 0, highCount: 0, total: 0, topDiv: 'N/A' }
    const getScore = r => monthFilter === 'All' ? (r.overall_average || 0) : (r.month_score || 0)
    const validRows = rows.filter(r => monthFilter === 'All' || r.month_score != null)
    if (!validRows.length) return { avg: 0, highCount: 0, total: 0, topDiv: 'N/A' }
    
    const totalScore = validRows.reduce((s, r) => s + getScore(r), 0)
    const avg = (totalScore / validRows.length).toFixed(1)
    const highCount = validRows.filter(r => getScore(r) >= 90).length
    
    const divScores = {}
    validRows.forEach(r => {
      if (!divScores[r.division]) divScores[r.division] = []
      divScores[r.division].push(getScore(r))
    })
    let topDiv = 'N/A', maxAvg = -1
    Object.entries(divScores).forEach(([d, scores]) => {
      const dAvg = scores.reduce((a, b) => a + b, 0) / scores.length
      if (dAvg > maxAvg) { maxAvg = dAvg; topDiv = d }
    })
    return { avg, highCount, total: validRows.length, topDiv }
  }, [rows, monthFilter])

  function exportCsv() {
    if (!data || !rows.length) return
    const head = ['Employee', 'Email', 'Month', 'Division', 'Department', 'Designation', 'Score', 'Rating Band']
    const lines = [
      head.join(','),
      ...rows.map(r => [
        r.employee,
        r.email || '',
        monthFilter === 'All' ? 'All Months (Overall)' : monthFilter,
        r.division || '',
        r.department || '',
        r.designation || '',
        monthFilter === 'All' ? (r.overall_average ?? '') : (r.month_score ?? 'N/A'),
        monthFilter === 'All' ? r.rating_band : r.month_band
      ].map(x => `"${String(x).replaceAll('"', '""')}"`).join(','))
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kpi-report-${monthFilter.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function bandClass(band) {
    if (band === 'Outstanding') return 'status-finalized'
    if (band === 'Very Good' || band === 'Good') return 'status-manager_reviewed'
    if (band === 'Needs Improvement') return 'status-submitted'
    return 'status-draft'
  }

  return <>
    <PageHeader 
      title="Performance Reports" 
      subtitle="Monthly & representative performance summaries with interactive month filtering." 
      actions={
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'nowrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px',background:'#ffffff',padding:'4px 8px',borderRadius:'8px',border:'1px solid #dbe2ea'}}>
            <Calendar size={15} style={{color:'#64748b'}}/>
            <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{border:'0',padding:'4px 0',outline:'none',background:'transparent',fontSize:'0.85rem',fontWeight:600}}>
              <option value="All">All Months (Overall)</option>
              {(data?.months || []).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <select value={division} onChange={e => setDivision(e.target.value)} style={{maxWidth:'180px'}}>
            {divisions.map(d => <option key={d}>{d}</option>)}
          </select>
          <button className="secondary" onClick={exportCsv} style={{whiteSpace:'nowrap'}}>
            <Download size={16}/>Export CSV
          </button>
        </div>
      }
    />
    <ErrorBox error={error}/>

    {!data ? <Loader/> : <>
      <div className="metric-grid compact" style={{marginBottom:'16px'}}>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'var(--color-muted,#64748b)'}}>
            <BarChart2 size={16}/><span>Average Score ({monthFilter})</span>
          </div>
          <strong className="small-metric">{metrics.avg}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'var(--color-muted,#64748b)'}}>
            <Award size={16}/><span>High Performers (≥90)</span>
          </div>
          <strong className="small-metric">{metrics.highCount}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'var(--color-muted,#64748b)'}}>
            <Users size={16}/><span>Evaluated Employees</span>
          </div>
          <strong className="small-metric">{metrics.total}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'var(--color-muted,#64748b)'}}>
            <TrendingUp size={16}/><span>Top Performing Division</span>
          </div>
          <strong className="small-metric" style={{fontSize:'1rem'}}>{metrics.topDiv}</strong>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card><div className="empty">No employee performance data found in the database.</div></Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Evaluation Month</th>
                  <th>Division & Department</th>
                  <th>Designation</th>
                  <th>{monthFilter === 'All' ? 'Overall Avg Score' : 'Month Score'}</th>
                  {monthFilter === 'All' ? <th>Latest Score</th> : null}
                  <th>Rating Band</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.user_id}>
                    <td>
                      <strong>{r.employee}</strong>
                      {r.email ? <div style={{fontSize:'0.75rem',color:'var(--color-muted,#64748b)'}}>{r.email}</div> : null}
                    </td>
                    <td>
                      <span className="status" style={{background:'var(--color-bg-subtle,#f1f5f9)',color:'var(--color-text,#1e293b)'}}>
                        {monthFilter === 'All' ? 'All Months' : monthFilter}
                      </span>
                    </td>
                    <td>
                      <div><strong>{r.division}</strong></div>
                      <small style={{color:'var(--color-muted,#64748b)'}}>{r.department}</small>
                    </td>
                    <td>{r.designation || '—'}</td>
                    <td>
                      <Score value={monthFilter === 'All' ? r.overall_average : r.month_score}/>
                    </td>
                    {monthFilter === 'All' ? <td><Score value={r.latest_score}/></td> : null}
                    <td>
                      <span className={`status ${bandClass(monthFilter === 'All' ? r.rating_band : r.month_band)}`}>
                        {monthFilter === 'All' ? r.rating_band : r.month_band}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>}
  </>
}
