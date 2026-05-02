export const config = { runtime: 'edge' };
const CORS = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'s-maxage=300'};
function hasKorean(s){return /[ㄱ-힣]/.test(s);}
async function translate(text){
  try{
    const r=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(text)+'&langpair=ko|en');
    const d=await r.json();
    const t=d&&d.responseData&&d.responseData.translatedText;
    return(t&&t!==text)?t:null;
  }catch(e){return null;}
}
async function search(q){
  try{
    const r=await fetch('https://query1.finance.yahoo.com/v1/finance/search?q='+encodeURIComponent(q)+'&quotesCount=8&newsCount=0&enableFuzzyQuery=true',{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://finance.yahoo.com'}});
    if(!r.ok)return[];
    const d=await r.json();
    return d&&d.quotes?d.quotes:[];
  }catch(e){return[];}
}
function mkt(e){
  if(e==='KSC')return'KOSPI';
  if(e==='KOE')return'KOSDAQ';
  if(e==='NMS'||e==='NGM'||e==='NCM')return'NASDAQ';
  if(e==='NYQ')return'NYSE';
  return e;
}
function fmt(quotes){
  const ok=['EQUITY','ETF','INDEX'];
  const out=[];
  for(let i=0;i<quotes.length;i++){
    const q=quotes[i];
    if(!ok.includes(q.quoteType))continue;
    const e=q.exchange||'';
    const s=q.symbol||'';
    out.push({symbol:s,name:q.longname||q.shortname||s,displayCode:s.replace('.KS','').replace('.KQ',''),market:mkt(e),exchange:e});
  }
  return out;
}
export default async function handler(req){
  const u=new URL(req.url);
  const q=u.searchParams.get('q');
  if(!q||q.length<1)return new Response(JSON.stringify({ok:true,data:[]}),{headers:CORS});
  try{
    let results=[];
    if(hasKorean(q)){
      results=fmt(await search(q));
      if(results.length<3){
        const tr=await translate(q);
        if(tr){
          const more=fmt(await search(tr));
          const seen={};
          for(let i=0;i<results.length;i++)seen[results[i].symbol]=true;
          for(let i=0;i<more.length;i++){if(!seen[more[i].symbol]){results.push(more[i]);seen[more[i].symbol]=true;}}
        }
      }
    }else{
      results=fmt(await search(q));
    }
    return new Response(JSON.stringify({ok:true,data:results.slice(0,8)}),{headers:CORS});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:err.message}),{status:500,headers:CORS});
  }
}
