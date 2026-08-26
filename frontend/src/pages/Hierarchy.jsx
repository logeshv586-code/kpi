import {useEffect, useMemo, useState} from 'react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader} from '../components/UI'

export default function Hierarchy() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/hierarchy').then(r => setRows(r.data)).catch(e => setError(getError(e))) }, [])
  const groups = useMemo(() => {
    const g = {}
    ;(rows || []).forEach(x => {
      const key = x.division || 'Corporate'
      g[key] ??= {}
      const dep = x.department || 'Corporate / Administration'
      g[key][dep] ??= []
      g[key][dep].push(x)
    })
    return g
  }, [rows])

  return <>
    <PageHeader title="Organization Hierarchy" subtitle="Division → department → designation → employee → reporting manager"/>
    <ErrorBox error={error}/>
    {!rows ? <Loader/> : <div className="hierarchy-grid">{Object.entries(groups).map(([div,deps]) => <Card key={div}><h3>{div}</h3>{Object.entries(deps).map(([dep,people]) => <div className="hier-dep" key={dep}><strong>{dep}</strong>{people.map(p => <div className="hier-person" key={p.id}><span className="avatar tiny">{p.name.slice(0,1)}</span><div><b>{p.name}</b><small>{p.designation || p.role}</small><small>{p.manager ? `Reports to ${p.manager}` : 'Top-level / no manager assigned'}</small></div></div>)}</div>)}</Card>)}</div>}
  </>
}
