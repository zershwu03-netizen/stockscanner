const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
function fn(name){const start=html.search(new RegExp('(?:async )?function '+name+'\\('));assert(start>=0,name); const rest=html.slice(start);const end=rest.slice(1).search(/\n(?:async )?function /);return end<0?rest:rest.slice(0,end+1);}
const c=vm.createContext({console,AbortController,DOMException,setTimeout,clearTimeout,Date,toast:()=>{},showPortProgress:()=>{},hidePortProgress:()=>{},savePortfolio:()=>{},renderPortfolio:()=>{}});
vm.runInContext(html.slice(html.indexOf('const PROXIES='),html.indexOf('// ===== ANALYSIS =====')),c);
(async()=>{
 let calls=0;c.fetch=async()=>{calls++;return {ok:true,status:200,text:async()=>JSON.stringify({chart:{result:[{meta:{}}]}})}};
 assert((await c.fetchYahoo('AAPL')).chart.result.length===1);assert.equal(calls,1);
 const ctrl=new AbortController();ctrl.abort();await assert.rejects(c.fetchYahoo('AAPL','6mo','1d',ctrl.signal),{name:'AbortError'});assert.equal(calls,1);
 c.fetch=async(u,{signal})=>({ok:true,status:200,text:()=>new Promise((r,j)=>signal.addEventListener('abort',()=>j(new DOMException('timeout','AbortError'))))});
 await assert.rejects(c.fetchWithTimeout('test',10,{readText:true}),{name:'AbortError'});
 // A forbidden proxy is skipped on the next symbol, while valid alternatives remain usable.
 calls=0;c.fetch=async()=>{calls++;return calls===1?{ok:false,status:403,text:async()=>''}:{ok:true,status:200,text:async()=>JSON.stringify({chart:{result:[{meta:{}}]}})}};
 await c.fetchYahoo('AAPL');await c.fetchYahoo('MSFT');assert.equal(calls,3);
 c.portfolio={us:[{sym:'AAPL',price:123,lastUpdatedAt:7}],tw:[]};
 vm.runInContext(fn('fetchPortfolioPrice'),c);c.fetchYahoo=async()=>{throw Error('offline')};
 assert.equal(await c.fetchPortfolioPrice('us',0),false);assert.equal(c.portfolio.us[0].price,123);assert.equal(c.portfolio.us[0].lastUpdatedAt,7);assert.equal(c.portfolio.us[0].quoteError,true);
 c._portUpdating=false;c.portfolio.us.push({sym:'MSFT'});c.fetchPortfolioPrice=async(m,i)=>i===0;
 let summary;c.toast=x=>summary=x;vm.runInContext(fn('reportPortfolioRefresh')+fn('updatePortfolioBatch')+fn('refreshPortfolio'),c);
 await c.refreshPortfolio('us');assert.match(summary,/成功 1 檔，失敗 1 檔/);assert.equal(c._portUpdating,false);
 c.fetchPortfolioPrice=async()=>{throw Error('storage error')};await c.refreshPortfolio('us');assert.match(summary,/失敗 2 檔/);assert.equal(c._portUpdating,false);
 c.AUTO_REFRESH_MS=1800000;vm.runInContext(fn('getPortfolioSuggestion'),c);
 assert.equal(c.getPortfolioSuggestion({quoteError:true},5,true).scoreText,'N/A');

 // Six-month range baseline must never be used as yesterday's close.
 const t=Date.parse('2026-09-18T05:30:00Z')/1000;
 const chart={meta:{regularMarketPrice:110,chartPreviousClose:50,regularMarketTime:t,exchangeTimezoneName:'Asia/Taipei'},timestamp:[t-86400,t],indicators:{quote:[{close:[100,110],high:[101,111],low:[99,109]}]}};
 assert.equal(c.dailyChange(chart),0.1);
 chart.meta.previousClose=105;assert.equal(c.dailyChange(chart),5/105);
 delete chart.meta.previousClose;chart.meta.regularMarketTime=t-86400;assert.equal(c.dailyChange(chart),null);
 assert.equal(c.changeText(null),'漲跌資料不足');
 // Missing high/low must remove the same candle across all series.
 chart.indicators.quote[0].high[0]=null;assert.equal(c.quoteRows(chart).length,1);
 // A valid price updates even when too few candles exist for technical analysis.
 vm.runInContext(fn('fetchPortfolioPrice'),c);
 c.portfolio={us:[{sym:'NEW',price:5,cost:3,qty:1,tech:{score:90}}],tw:[]};
 c.fetchYahoo=async()=>({chart:{result:[{meta:{regularMarketPrice:10,regularMarketTime:Date.now()/1000},indicators:{quote:[{close:[10],high:[11],low:[9]}]}}]}});
 assert.equal(await c.fetchPortfolioPrice('us',0),true);assert.equal(c.portfolio.us[0].price,10);assert.equal(c.portfolio.us[0].tech,null);
 assert.equal(c.getPortfolioSuggestion(c.portfolio.us[0],100,true).action,'分析資料不足');
 // Concurrent quantity edits must survive a pending quote request.
 c.fetchYahoo=async()=>{c.portfolio.us[0].qty=7;return {chart:{result:[{meta:{regularMarketPrice:12,regularMarketTime:Date.now()/1000},indicators:{quote:[{close:[],high:[],low:[]}]}}]}}};
 assert.equal(await c.fetchPortfolioPrice('us',0),true);assert.equal(c.portfolio.us[0].qty,7);
 console.log('PASS: script syntax, fallback, cancellation, body timeout, proxy cooldown, failure preservation, accurate counts, lock cleanup, stale analysis');
})().catch(e=>{console.error(e);process.exitCode=1});
// Isolated routing regression: an upstream 404 resolves Taiwan OTC suffixes.
(async()=>{
 const d=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,Date});
 vm.runInContext(html.slice(html.indexOf('const PROXIES='),html.indexOf('// ===== ANALYSIS =====')),d);
 let seen=[];
 d.fetch=async url=>{
  seen.push(decodeURIComponent(url));
  const found=seen.at(-1).includes('6488.TWO');
  return {ok:found,status:found?200:404,text:async()=>JSON.stringify(found?{chart:{result:[{meta:{symbol:'6488.TWO'}}]}}:{chart:{error:{code:'Not Found'}}})};
 };
 const got=await d.fetchYahoo('6488.TW');assert.equal(got.chart.result[0].meta._resolvedSymbol,'6488.TWO');assert.equal(seen.length,2);
 console.log('PASS: HTTP 404 OTC resolution');
})().catch(e=>{console.error(e);process.exitCode=1});
