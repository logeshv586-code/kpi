import {useEffect, useMemo, useState} from 'react'
import {Award, BarChart2, Calendar, ChevronLeft, ChevronRight, Download, Filter, TrendingUp, Users} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Score} from '../components/UI'

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function getRatingBand(score) {
  if (score >= 90) return 'Outstanding'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Needs Improvement'
  return 'Improvement Required'
}

export default function Reports() {
  const {user} = useAuth()
  const [data, setData] = useState(null)
  const [division, setDivision] = useState('All')
  const [monthFilter, setMonthFilter] = useState('All')
  const [error, setError] = useState('')
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [calYear, setCalYear] = useState(2026)

  const title = ['superadmin','hr'].includes(user?.role) 
    ? "Performance Reports" 
    : user?.role === 'manager' 
    ? "Team Performance Reports" 
    : "My Performance Report"

  const subtitle = ['superadmin','hr'].includes(user?.role)
    ? "Monthly & representative performance summaries with interactive month filtering."
    : user?.role === 'manager'
    ? "Monthly evaluation scores and progress summaries for your direct reports."
    : "Your monthly evaluation scores, rating bands, and performance history."

  useEffect(() => {
    api.get('/dashboard/monthly-matrix')
      .then(r => setData(r.data))
      .catch(e => setError(getError(e)))
  }, [])

  const divisions = useMemo(() => ['All', ...new Set((data?.rows || []).map(r => r.division))], [data])
  const availableMonths = useMemo(() => data?.months || [], [data])

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
    const avg = roundOne(totalScore / validRows.length)
    const highCount = validRows.filter(r => getScore(r) >= 90).length

    const divScores = {}
    validRows.forEach(r => {
      if (r.division) {
        if (!divScores[r.division]) divScores[r.division] = { total: 0, count: 0 }
        divScores[r.division].total += getScore(r)
        divScores[r.division].count += 1
      }
    })
    
    let topDiv = 'N/A'
    let topDivAvg = -1
    Object.entries(divScores).forEach(([d, { total, count }]) => {
      const divAvg = total / count
      if (divAvg > topDivAvg) {
        topDivAvg = divAvg
        topDiv = d
      }
    })

    return { avg, highCount, total: validRows.length, topDiv }
  }, [rows, monthFilter])

  function roundOne(val) {
    return Math.round(val * 10) / 10
  }

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

  function selectMonth(label) {
    setMonthFilter(label)
    setShowMonthModal(false)
  }

  return <>
    <PageHeader 
      title={title} 
      subtitle={subtitle} 
      actions={
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'nowrap'}}>
          {/* Interactive Calendar Month Picker Button */}
          <button 
            type="button" 
            onClick={() => setShowMonthModal(true)} 
            style={{
              display:'inline-flex',
              alignItems:'center',
              gap:'8px',
              background:'#ffffff',
              border:'1px solid #cbd5e1',
              padding:'6px 12px',
              borderRadius:'8px',
              fontSize:'0.85rem',
              fontWeight:650,
              color:'#0f172a',
              cursor:'pointer',
              boxShadow:'0 1px 2px rgba(15,23,42,0.05)'
            }}
          >
            <Calendar size={16} style={{color:'#2563eb'}}/>
            <span>{monthFilter === 'All' ? 'All Months (Overall)' : monthFilter}</span>
          </button>

          {divisions.length > 2 ? (
            <select value={division} onChange={e => setDivision(e.target.value)} style={{maxWidth:'180px'}}>
              {divisions.map(d => <option key={d}>{d}</option>)}
            </select>
          ) : null}

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
            <Users size={16}/><span>Evaluated Records</span>
          </div>
          <strong className="small-metric">{metrics.total}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'var(--color-muted,#64748b)'}}>
            <TrendingUp size={16}/><span>Top Division</span>
          </div>
          <strong className="small-metric" style={{fontSize:'1rem',wordBreak:'break-word'}}>{metrics.topDiv}</strong>
        </Card>
      </div>

      <Card>
        <div style={{display:'flex',alignItems:'center',justify:'space-between',marginBottom:'14px',flexWrap:'wrap',gap:'8px'}}>
          <div style={{fontSize:'0.9rem',fontWeight:700,color:'#1e293b'}}>
            Performance Matrix for: <span style={{color:'#2563eb'}}>{monthFilter === 'All' ? 'All Months (Overall)' : monthFilter}</span>
          </div>
          {monthFilter !== 'All' ? (
            <button className="text-action" onClick={() => setMonthFilter('All')} style={{fontSize:'0.8rem'}}>
              Reset to All Months
            </button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Division</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Evaluation Month</th>
                <th>Score</th>
                <th>Rating Band</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const score = monthFilter === 'All' ? r.overall_average : r.month_score
                const band = monthFilter === 'All' ? r.rating_band : r.month_band
                return (
                  <tr key={r.user_id}>
                    <td>
                      <strong>{r.employee}</strong>
                      <div className="cell-help">{r.email}</div>
                    </td>
                    <td>{r.division || '—'}</td>
                    <td>{r.department || '—'}</td>
                    <td>{r.designation || '—'}</td>
                    <td>
                      <span style={{fontSize:'0.85rem',fontWeight:600,color:'#475569'}}>
                        {monthFilter === 'All' ? 'All Months (Overall)' : (r.display_month || monthFilter)}
                      </span>
                    </td>
                    <td>
                      {score != null ? <Score value={score}/> : <span className="muted">N/A</span>}
                    </td>
                    <td>
                      <span className={`status-badge ${bandClass(band)}`}>
                        {band}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className="empty">No performance data found for this filter.</div> : null}
      </Card>
    </>}

    {/* Interactive Calendar Month Picker Modal */}
    {showMonthModal ? (
      <Modal 
        title="Select Report Month & Year Calendar" 
        onClose={() => setShowMonthModal(false)}
        actions={
          <button className="secondary" onClick={() => setShowMonthModal(false)}>Close</button>
        }
      >
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{display:'flex',justify:'space-between',alignItems:'center',background:'#f8fafc',padding:'10px 14px',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
            <button 
              type="button" 
              className={monthFilter === 'All' ? 'primary small' : 'secondary small'}
              onClick={() => selectMonth('All')}
            >
              All Months (Overall)
            </button>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <button type="button" className="icon-button" onClick={() => setCalYear(y => y - 1)}><ChevronLeft size={16}/></button>
              <strong style={{fontSize:'1rem',color:'#0f172a'}}>{calYear}</strong>
              <button type="button" className="icon-button" onClick={() => setCalYear(y => y + 1)}><ChevronRight size={16}/></button>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'10px'}}>
            {monthNames.map((mName, mIdx) => {
              const label = `${mName} ${calYear}`
              const isAvailable = availableMonths.includes(label)
              const isSelected = monthFilter === label
              return (
                <button
                  key={mName}
                  type="button"
                  onClick={() => selectMonth(label)}
                  style={{
                    padding:'12px 8px',
                    borderRadius:'8px',
                    border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    background: isSelected ? '#eff6ff' : isAvailable ? '#ffffff' : '#f8fafc',
                    color: isSelected ? '#1d4ed8' : isAvailable ? '#0f172a' : '#94a3b8',
                    fontWeight: isSelected || isAvailable ? 700 : 500,
                    cursor:'pointer',
                    display:'flex',
                    flexDirection:'column',
                    alignItems:'center',
                    gap:'4px',
                    boxShadow: isSelected ? '0 0 0 3px #dbeafe' : 'none'
                  }}
                >
                  <span>{mName}</span>
                  {isAvailable ? (
                    <span style={{fontSize:'0.65rem',background:'#dbeafe',color:'#1e40af',padding:'1px 6px',borderRadius:'6px',fontWeight:600}}>
                      Report Data
                    </span>
                  ) : (
                    <span style={{fontSize:'0.65rem',color:'#94a3b8'}}>No Data</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    ) : null}
  </>
}
