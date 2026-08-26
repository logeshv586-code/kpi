import {Navigate, Route, Routes} from 'react-router-dom'
import {useAuth} from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import KpiInput from './pages/KpiInput'
import MyKpi from './pages/MyKpi'
import KpiDashboard from './pages/KpiDashboard'
import Templates from './pages/Templates'
import TemplateBuilder from './pages/TemplateBuilder'
import Cycles from './pages/Cycles'
import Assignments from './pages/Assignments'
import Employees from './pages/Employees'
import Hierarchy from './pages/Hierarchy'
import Approvals from './pages/Approvals'
import Reports from './pages/Reports'
import Masters from './pages/Masters'
import Audit from './pages/Audit'
import Settings from './pages/Settings'

function RoleGate({roles, children}) {
  const {user} = useAuth()
  return roles.includes(user?.role) ? children : <Navigate to="/dashboard" replace/>
}

function Protected() {
  const {user} = useAuth()
  if (!user) return <Navigate to="/login" replace/>
  return <Layout><Routes>
    <Route path="dashboard" element={<Dashboard/>}/>
    <Route path="kpi-input" element={<KpiInput/>}/>
    <Route path="kpi" element={<MyKpi/>}/>
    <Route path="kpi-dashboard" element={<KpiDashboard/>}/>
    <Route path="approvals" element={<RoleGate roles={['superadmin','hr','manager']}><Approvals/></RoleGate>}/>
    <Route path="templates" element={<RoleGate roles={['superadmin','hr']}><Templates/></RoleGate>}/>
    <Route path="templates/new" element={<RoleGate roles={['superadmin','hr']}><TemplateBuilder/></RoleGate>}/>
    <Route path="cycles" element={<RoleGate roles={['superadmin','hr']}><Cycles/></RoleGate>}/>
    <Route path="assignments" element={<RoleGate roles={['superadmin','hr']}><Assignments/></RoleGate>}/>
    <Route path="employees" element={<RoleGate roles={['superadmin','hr']}><Employees/></RoleGate>}/>
    <Route path="hierarchy" element={<RoleGate roles={['superadmin','hr']}><Hierarchy/></RoleGate>}/>
    <Route path="reports" element={<RoleGate roles={['superadmin','hr']}><Reports/></RoleGate>}/>
    <Route path="masters" element={<RoleGate roles={['superadmin','hr']}><Masters/></RoleGate>}/>
    <Route path="audit" element={<RoleGate roles={['superadmin','hr']}><Audit/></RoleGate>}/>
    <Route path="settings" element={<RoleGate roles={['superadmin','hr']}><Settings/></RoleGate>}/>
    <Route index element={<Navigate to="dashboard" replace/>}/>
    <Route path="*" element={<Navigate to="dashboard" replace/>}/>
  </Routes></Layout>
}

export default function App() {
  const {user} = useAuth()
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace/> : <Login/>}/>
    <Route path="/*" element={<Protected/>}/>
  </Routes>
}
