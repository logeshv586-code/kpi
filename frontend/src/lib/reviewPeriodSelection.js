export function localMonthKey(date=new Date()){
  const year=date.getFullYear()
  const month=String(date.getMonth()+1).padStart(2,'0')
  return `${year}-${month}`
}

export function currentFinancialYear(date=new Date()){
  const year=date.getFullYear()
  const month=date.getMonth()+1
  const startYear=month>=4?year:year-1
  return `FY ${startYear}-${String(startYear+1).slice(-2)}`
}

function rowMonth(row){
  return String(row?.month||'').slice(0,7)
}

function preferReviewType(rows,reviewType='monthly'){
  if(!rows.length)return null
  return rows.find(row=>(row.review_type||'monthly')===reviewType)||
    rows.find(row=>row.status==='running')||
    rows[0]
}

export function chooseDefaultReviewPeriod(rows,date=new Date(),reviewType='monthly'){
  const available=(rows||[]).filter(Boolean)
  if(!available.length)return null

  const current=localMonthKey(date)
  const currentMonthRows=available.filter(row=>rowMonth(row)===current)
  const currentPreferred=preferReviewType(currentMonthRows,reviewType)
  if(currentPreferred)return currentPreferred

  const past=available
    .filter(row=>rowMonth(row)&&rowMonth(row)<current)
    .sort((a,b)=>rowMonth(b).localeCompare(rowMonth(a))||Number(b.id||0)-Number(a.id||0))
  if(past.length){
    const latestPastMonth=rowMonth(past[0])
    const latestPastRows=past.filter(row=>rowMonth(row)===latestPastMonth)
    return preferReviewType(latestPastRows,reviewType)||past[0]
  }

  const sorted=[...available].sort((a,b)=>{
    const ma=rowMonth(a),mb=rowMonth(b)
    if(ma!==mb)return mb.localeCompare(ma)
    return Number(b.id||0)-Number(a.id||0)
  })
  return sorted[0]
}

export function chooseDefaultReportOption(reviewType,options,date=new Date()){
  const available=options||[]
  if(!available.length)return null

  const month=date.getMonth()+1
  const current=localMonthKey(date)

  if(reviewType==='monthly'){
    return available.find(option=>String(option.month||'').startsWith(current))||
      available.find(option=>option.status==='running')||
      available[0]
  }

  if(reviewType==='quarterly'){
    const quarter=month<=3?'Q4':month<=6?'Q1':month<=9?'Q2':'Q3'
    return available.find(option=>String(option.key||'').startsWith(quarter))||
      available.find(option=>option.status==='running')||
      available[0]
  }

  if(reviewType==='half_yearly'){
    const half=month>=4&&month<=9?'H1':'H2'
    return available.find(option=>String(option.key||'').startsWith(half))||
      available.find(option=>option.status==='running')||
      available[0]
  }

  if(reviewType==='annual'){
    return available.find(option=>option.key==='annual_full')||available[0]
  }

  return available.find(option=>option.status==='running')||available[0]
}
