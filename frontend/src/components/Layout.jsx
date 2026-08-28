import {NavLink, useNavigate} from 'react-router-dom'
import {BarChart3, FileInput, FileSpreadsheet, HelpCircle, KeyRound, LogOut, Settings as SettingsIcon, Users} from 'lucide-react'
import {canAccessTab, useAuth} from '../lib/auth'
import {useState} from 'react'
import {api, getError} from '../lib/api'
import {ErrorBox, Modal} from './UI'

const coreNavigation = [
  ['/reports', BarChart3, 'Reports'],
  ['/employees', Users, 'Employees Directory'],
  ['/templates', FileSpreadsheet, 'KPI Templates'],
  ['/kpi-input', FileInput, 'KPI Input'],
  ['/settings', SettingsIcon, 'Settings & Reset Data']
]
export default function Layout({children}) {
  const {user, logout} = useAuth()
  const nav = useNavigate()
  const navigation = coreNavigation.filter(([to]) => canAccessTab(user, to.slice(1)))
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwords, setPasswords] = useState({current_password: '', new_password: '', confirm_password: ''})
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  function help() {
    localStorage.removeItem('kpi_guide_dismissed')
    nav('/kpi-input?guide=1')
  }

  async function changePassword() {
    try {
      setPasswordError('')
      if (passwords.new_password !== passwords.confirm_password) throw new Error('New password and confirmation do not match.')
      await api.post('/auth/change-password', {current_password: passwords.current_password, new_password: passwords.new_password})
      setPasswordMessage('Password changed. Use the new password the next time you sign in.')
      setPasswords({current_password: '', new_password: '', confirm_password: ''})
    } catch (error) {
      setPasswordError(getError(error))
    }
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
          <button className="help-button" onClick={() => { setPasswordError(''); setPasswordMessage(''); setPasswordOpen(true) }}>
            <KeyRound size={16}/>
            <span>Change password</span>
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
      {passwordOpen ? <Modal title="Change password" onClose={() => setPasswordOpen(false)} actions={<><button className="secondary" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="primary" onClick={changePassword}>Save password</button></>}>
        <p className="small-copy muted">Enter your temporary/current password, then choose the password you will use for future sign-ins.</p>
        <ErrorBox error={passwordError}/>
        {passwordMessage ? <div className="helper-strip">{passwordMessage}</div> : null}
        <div className="form-grid" style={{gridTemplateColumns: '1fr'}}>
          <label>Current password<input type="password" value={passwords.current_password} onChange={e => setPasswords({...passwords, current_password: e.target.value})} autoComplete="current-password"/></label>
          <label>New password<input type="password" value={passwords.new_password} onChange={e => setPasswords({...passwords, new_password: e.target.value})} autoComplete="new-password"/></label>
          <label>Confirm new password<input type="password" value={passwords.confirm_password} onChange={e => setPasswords({...passwords, confirm_password: e.target.value})} autoComplete="new-password"/></label>
        </div>
      </Modal> : null}
    </div>
  )
}
