import axios from 'axios'

export const api = axios.create({baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api'})
api.interceptors.request.use((config)=>{const token=localStorage.getItem('kpi_token'); if(token) config.headers.Authorization=`Bearer ${token}`; return config})
api.interceptors.response.use(r=>r,err=>{if(err.response?.status===401){localStorage.removeItem('kpi_token');localStorage.removeItem('kpi_user');if(location.pathname!='/login')location.href='/login'}return Promise.reject(err)})

export const getError=(e)=>{
  const detail=e?.response?.data?.detail
  if(Array.isArray(detail)) return detail.map(x=>x.msg||'Invalid value').join(', ')
  if(typeof detail==='string') return detail
  return e?.message || 'Something went wrong. Please try again.'
}

export function apiFileUrl(value){
  const url=typeof value==='string'?value:value?.url
  if(!url) return ''
  if(/^https?:\/\//i.test(url)) return url
  const base=String(api.defaults.baseURL||'')
  if(base.startsWith('http')){
    try{return new URL(url,new URL(base).origin).toString()}catch{return url}
  }
  return url
}

export async function downloadApiFile(endpoint, fallbackName='download'){
  const response=await api.get(endpoint,{responseType:'blob'})
  const blobUrl=URL.createObjectURL(response.data)
  const disposition=response.headers['content-disposition']||''
  const match=disposition.match(/filename="?([^";]+)"?/i)
  const a=document.createElement('a')
  a.href=blobUrl;a.download=match?.[1]||fallbackName;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(blobUrl)
}
