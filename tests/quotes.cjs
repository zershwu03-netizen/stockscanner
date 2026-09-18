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
 let summary;c.toast=x=>summary=x;vm.runInContext(fn('reportPortfolioRefresh')+fn('refreshPortfolio'),c);
 await c.refreshPortfolio('us');assert.match(summary,/成功 1 檔，失敗 1 檔/);assert.equal(c._portUpdating,false);
 c.fetchPortfolioPrice=async()=>{throw Error('storage error')};await assert.rejects(c.refreshPortfolio('us'));assert.equal(c._portUpdating,false);
 c.AUTO_REFRESH_MS=1800000;vm.runInContext(fn('getPortfolioSuggestion'),c);
 assert.equal(c.getPortfolioSuggestion({quoteError:true},5,true).scoreText,'N/A');
 console.log('PASS: script syntax, fallback, cancellation, body timeout, proxy cooldown, failure preservation, accurate counts, lock cleanup, stale analysis');
})().catch(e=>{console.error(e);process.exitCode=1});
