import {NavLink, useNavigate} from 'react-router-dom'
import {BarChart3, FileInput, FileSpreadsheet, HelpCircle, LogOut, Users} from 'lucide-react'
import {useAuth} from '../lib/auth'

const adminNavigation = [['/reports', BarChart3, 'Reports'], ['/employees', Users, 'Employees Directory'], ['/templates', FileSpreadsheet, 'KPI Templates'], ['/kpi-input', FileInput, 'KPI Input']]
const managerNavigation = [['/reports', BarChart3, 'Team Reports'], ['/employees', Users, 'Employees Directory'], ['/templates', FileSpreadsheet, 'KPI Templates'], ['/kpi-input', FileInput, 'KPI Input']]
const employeeNavigation = [['/reports', BarChart3, 'My Reports'], ['/employees', Users, 'Employee Directory'], ['/templates', FileSpreadsheet, 'KPI Templates'], ['/kpi-input', FileInput, 'KPI Input']]

export default function Layout({children}) {
  const {user, logout} = useAuth()
  const nav = useNavigate()
  const isAdmin = ['superadmin', 'hr'].includes(user?.role)
  const isManager = user?.role === 'manager'
  const navigation = isAdmin ? adminNavigation : isManager ? managerNavigation : employeeNavigation

  function help() {
    localStorage.removeItem('kpi_guide_dismissed')
    nav('/kpi-input?guide=1')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KPI System</strong>
            <span>Performance Management</span>
          </div>
        </div>
        <div className="nav-section">
          <div className="nav-label">Workspace</div>
          {navigation.map(([to, Icon, label]) => (
            <NavLink key={to} to={to} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18}/>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={help}>
            <HelpCircle size={16}/>
            <span>Help & guide</span>
          </button>
          <div className="user-mini">
            <div className="avatar">{user?.name?.slice(0, 1)}</div>
            <div>
              <strong>{user?.name}</strong>
              <span>{user?.designation || user?.role}</span>
              {user?.department ? <small>{user.department}</small> : null}
            </div>
          </div>
          <button className="link-button" onClick={() => { logout(); nav('/login') }}>
            <LogOut size={16}/> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">Monthly KPI Performance Management</div>
          <div className="top-context">
            <span>{user?.department || 'Organization'}</span>
            <div className="avatar small">{user?.name?.slice(0, 1)}</div>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  )
}
