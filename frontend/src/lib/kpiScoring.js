export const numericTypes=['number','count','currency','percentage','days']
export const whole=value=>Math.round(Number(value||0))
export const score2=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100
export const scoreText=value=>score2(value).toFixed(2)
export const isChoice=item=>['choice','yesno'].includes(item?.input_type)
export const isKraAverage100=item=>item?.config?.meta?.scoring_model==='kra_average_100'
export const isMeasurementTarget=item=>isKraAverage100(item)&&item?.config?.meta?.scoring_method==='measurement_target'

export const measurementLabels={
  number:'Number',
  count:'Quantity / Count',
  currency:'Currency',
  percentage:'Percentage',
  days:'Days / Time',
  choice:'Custom Dropdown'
}

export function metricUnit(item){
  const configured=String(item?.config?.meta?.unit||'').trim()
  if(configured)return configured
  if(item?.input_type==='percentage')return '%'
  if(item?.input_type==='days')return 'days'
  if(item?.input_type==='currency')return 'INR'
  return 'units'
}

export function minimumScore(item){
  const meta=item?.config?.meta||{},value=Number(meta.minimum_score??meta.threshold_min??0)
  return Number.isFinite(value)?Math.max(0,Math.min(100,whole(value))):0
}

export function qualifyingValue(item){
  const meta=item?.config?.meta||{},value=Number(meta.qualifying_value??0)
  return Number.isFinite(value)?Math.max(0,whole(value)):0
}

export function targetValue(item){
  const value=Number(item?.target_value??100)
  return Number.isFinite(value)?Math.max(0,whole(value)):100
}

export function formatMetric(value,item){
  if(value===null||value===undefined||value==='')return '—'
  const unit=metricUnit(item)
  return `${whole(value)}${unit?` ${unit}`:''}`
}

export function qualificationStatus(item,value,prefix=''){
  if(!isMeasurementTarget(item)||isChoice(item))return{configured:false,passed:null}
  const raw=value?.[`${prefix}actual_numeric`]
  const qualifier=qualifyingValue(item)
  const direction=item?.direction==='lower'?'lower':'higher'
  if(raw===null||raw===undefined||raw==='')return{configured:qualifier>0,passed:null,qualifier,direction}
  const actual=Number(raw)
  if(!Number.isFinite(actual))return{configured:qualifier>0,passed:false,qualifier,direction,actual}
  if(qualifier<=0)return{configured:false,passed:true,qualifier,direction,actual,reason:'No qualification gate'}
  const passed=direction==='lower'?actual<=qualifier:actual>=qualifier
  const reason=passed?'Qualification achieved':direction==='lower'?`Must be ${qualifier} or lower`:`Must be ${qualifier} or higher`
  return{configured:true,passed,qualifier,direction,actual,reason}
}

export function legacyThresholdInfo(item,value,prefix=''){
  if(!numericTypes.includes(item?.input_type))return{configured:false,passed:null}
  const meta=item?.config?.meta||{},raw=value?.[`${prefix}actual_numeric`]
  const min=meta.threshold_min===null||meta.threshold_min===undefined||meta.threshold_min===''?null:Number(meta.threshold_min)
  const max=meta.threshold_max===null||meta.threshold_max===undefined||meta.threshold_max===''?null:Number(meta.threshold_max)
  const rule=meta.threshold_rule&&meta.threshold_rule!=='none'?meta.threshold_rule:(min!==null&&max!==null?'range':min!==null?'minimum':max!==null?'maximum':'none')
  if(rule==='none'||(min===null&&max===null))return{configured:false,passed:null,rule,min,max}
  if(raw===null||raw===undefined||raw==='')return{configured:true,passed:null,rule,min,max}
  const actual=Number(raw)
  let passed=true,reason='Threshold achieved'
  if(rule==='minimum'&&min!==null){passed=actual>=min;reason=passed?'Minimum achieved':`Minimum ${min} not achieved`}
  else if(rule==='maximum'&&max!==null){passed=actual<=max;reason=passed?'Maximum limit met':`Maximum ${max} exceeded`}
  else if(rule==='range'){
    if(min!==null&&actual<min){passed=false;reason=`Minimum ${min} not achieved`}
    else if(max!==null&&actual>max){passed=false;reason=`Maximum ${max} exceeded`}
    else reason='Within acceptable range'
  }
  return{configured:true,passed,rule,min,max,reason,actual}
}

export function legacyItemScore(item,value,prefix=''){
  const v=value||{},cfg=item?.config||{},meta=cfg.meta||{},weight=Number(item?.weight||0)
  const cap=Math.max(0,Number(meta.score_cap_pct??100)/100)
  if(isChoice(item)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const pct=Number((cfg.score_map||{})[selected]||0)
    return whole(weight*Math.max(0,Math.min(pct/100,cap)))
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Number(raw)
  if(!Number.isFinite(actual)||legacyThresholdInfo(item,v,prefix).passed===false)return 0
  let ratio=0
  if(item.input_type==='rating')ratio=actual/Math.max(1,Number(cfg.max_rating||5))
  else if(meta.scoring_method==='direct_percentage'||(item.input_type==='percentage'&&item.target_value==null))ratio=actual/100
  else if(item.target_value==null)ratio=actual/100
  else if(item.direction==='lower'&&Number(item.target_value)===0)ratio=actual<=0?1:0
  else if(item.direction==='lower'){
    const target=Number(item.target_value);ratio=actual<=target||actual<=0?1:target/actual
  }else{
    const target=Number(item.target_value);ratio=target===0?(actual>=0?1:0):actual/target
  }
  return whole(weight*Math.max(0,Math.min(ratio,cap)))
}

export function kpiScore100(item,value,prefix=''){
  const v=value||{},cfg=item?.config||{}
  if(!isKraAverage100(item)){
    const weight=Number(item?.weight||0),legacy=legacyItemScore(item,value,prefix)
    return weight>0?whole(legacy/weight*100):0
  }
  if(isChoice(item)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const raw=whole(Math.max(0,Math.min(100,Number((cfg.score_map||{})[selected]||0))))
    return raw<minimumScore(item)?0:raw
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Math.max(0,whole(Number(raw)))
  if(!Number.isFinite(actual))return 0

  if(isMeasurementTarget(item)){
    if(qualificationStatus(item,v,prefix).passed===false)return 0
    const target=targetValue(item)
    if(item.direction==='lower'){
      if(actual<=target)return 100
      if(actual<=0)return 100
      return whole(Math.max(0,Math.min(100,target/actual*100)))
    }
    if(target<=0)return actual>0?100:0
    return whole(Math.max(0,Math.min(100,actual/target*100)))
  }

  return actual<minimumScore(item)?0:Math.max(0,Math.min(100,actual))
}

export function kraAverage(kra,values,prefix=''){
  if(!kra?.items?.length)return 0
  if(kra.items.every(isKraAverage100))return kra.items.reduce((sum,item)=>sum+kpiScore100(item,values[item.id],prefix),0)/kra.items.length
  const weight=Number(kra.weight||0)
  if(weight<=0)return 0
  return kra.items.reduce((sum,item)=>sum+legacyItemScore(item,values[item.id],prefix),0)/weight*100
}

export function kraScore(kra,values,prefix=''){
  if(!kra?.items?.length)return 0
  if(kra.items.every(isKraAverage100))return kraAverage(kra,values,prefix)*Number(kra.weight||0)/100
  return kra.items.reduce((sum,item)=>sum+legacyItemScore(item,values[item.id],prefix),0)
}

export function templateScore(kras,values,prefix=''){
  return Math.min(100,score2((kras||[]).reduce((sum,kra)=>sum+kraScore(kra,values,prefix),0)))
}
