import type { TodoStore } from './db.ts';

export const DEFAULT_ENVIRONMENT={city:'济南',latitude:36.6683,longitude:116.9972,timezone:'Asia/Shanghai',timeMode:'auto',weatherMode:'auto'};
const TTL=15*60*1000;
const pending=new Map<string,Promise<any>>();

export function environmentSettings(store: TodoStore) {
  return {...DEFAULT_ENVIRONMENT,...store.getSetting('farm-environment',{})};
}

export async function saveEnvironment(store: TodoStore, input: any, request=fetch) {
  const city=String(input.city || '').trim();
  if(city.length<2 || city.length>80) throw Object.assign(new Error('请输入 2–80 个字的城市名'),{statusCode:400});
  if(!['auto','day','sunset','night'].includes(input.timeMode) || !['auto','clear','cloudy','rain','snow'].includes(input.weatherMode)) throw Object.assign(new Error('环境选项无效'),{statusCode:400});
  let location=environmentSettings(store);
  if(city!==location.city) {
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search=new URLSearchParams({name:city,count:'5',language:'zh',format:'json'}).toString();
    const response=await request(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('城市查询暂时不可用，请稍后重试');
    const result=await response.json() as any;
    const match=result.results?.find((item:any)=>item.country_code==='CN') || result.results?.[0];
    if(!match) throw Object.assign(new Error('未找到城市，请尝试城市全名或拼音'),{statusCode:400});
    location={...location,latitude:match.latitude,longitude:match.longitude,timezone:match.timezone || 'Asia/Shanghai'};
  }
  const settings={...location,city,timeMode:input.timeMode,weatherMode:input.weatherMode};
  store.setSetting('farm-environment',settings);
  return settings;
}

export async function farmWeather(store: TodoStore, request=fetch) {
  const settings=environmentSettings(store);
  const key=`${settings.latitude},${settings.longitude}`;
  const cached=store.getSetting('farm-weather-cache',null);
  if(cached?.key===key && Date.now()-cached.fetchedAt<TTL) return {...cached,settings,stale:false};
  if(pending.has(key)) return pending.get(key)!.then(snapshot=>({...snapshot,settings:environmentSettings(store)}));
  const job=(async()=>{
    try {
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.search=new URLSearchParams({latitude:String(settings.latitude),longitude:String(settings.longitude),current:'temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day',daily:'sunrise,sunset',timezone:settings.timezone,forecast_days:'1'}).toString();
      const response=await request(url,{signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error(`天气服务暂不可用 (${response.status})`);
      const result=await response.json() as any;
      if(!result.current || !Number.isFinite(result.current.weather_code) || !Number.isFinite(result.current.temperature_2m)) throw new Error('天气数据格式无效');
      const snapshot={key,available:true,current:result.current,sunrise:result.daily?.sunrise?.[0],sunset:result.daily?.sunset?.[0],fetchedAt:Date.now(),source:'Open-Meteo'};
      store.setSetting('farm-weather-cache',snapshot);
      return {...snapshot,settings,stale:false};
    } catch(error) {
      return {...(cached?.key===key ? cached : {available:false}),settings,stale:true,error:error instanceof Error ? error.message : String(error)};
    } finally {pending.delete(key);}
  })();
  pending.set(key,job);
  return job;
}
