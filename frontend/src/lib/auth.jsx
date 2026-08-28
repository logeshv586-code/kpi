import {createContext, useContext, useEffect, useMemo, useState} from 'react'
import {api} from './api'

const AuthContext = createContext(null)
function savedUser(){try{return JSON.parse(localStorage.getItem('kpi_user')||'null')}catch{return null}}

export function AuthProvider({children}){
  const [user,setUser]=useState(savedUser)
  useEffect(()=>{
    if(!localStorage.getItem('kpi_token')) return
    api.get('/auth/me').then(({data})=>{localStorage.setItem('kpi_user',JSON.stringify(data));setUser(data)}).catch(()=>{})
  },[])
  const value=useMemo(()=>({
    user,
    login(data){localStorage.setItem('kpi_token',data.access_token);localStorage.setItem('kpi_user',JSON.stringify(data.user));setUser(data.user)},
    logout(){localStorage.removeItem('kpi_token');localStorage.removeItem('kpi_user');setUser(null)}
  }),[user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export const useAuth=()=>useContext(AuthContext)

export const canAccessTab = (user, tab, edit = false) => {
  if (user?.role === 'superadmin') return true
  const permissions = user?.permissions || {}
  const allowed = permissions[edit ? 'editable_tabs' : 'tabs'] || (edit ? ['kpi-input'] : ['kpi-input', 'reports', 'employees'])
  return allowed.includes('*') || allowed.includes(tab)
}
