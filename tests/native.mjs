import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let handler, result, requestedMid, failed = 0;
const storage = { 'kp.access_token': 'test-token' };
const ctx = vm.createContext({ Date, setInterval() {}, clearInterval() {},
 location: { href: 'https://dearlordylord.github.io/kinopub-msx/public/app.html' },
 localStorage: { getItem(k) { return storage[k] || null; }, setItem(k,v) { storage[k]=v; }, removeItem(k) { delete storage[k]; } },
 TVXPluginTools: { onReady(fn) { fn(); } },
 TVXInteractionPlugin: { setupHandler(h) { handler=h; }, init() { handler.init(); }, error() { failed++; } }
});
for (const name of ['config','util','store','api','ui','native','app']) vm.runInContext(fs.readFileSync(new URL('../public/js/'+name+'.js',import.meta.url),'utf8'),ctx);
const base='https://unit.ams-static-14.cdntogo.net/secret/master-v1a1.m3u8?signature=opaque';
ctx.KP_API.item=(id,noLinks,cb)=>{ assert.equal(String(id),'18009'); cb(null,{item:{seasons:[{number:1,episodes:[{id:701,number:1,audios:[{index:1,lang:'rus',codec:'aac'},{index:2,lang:'jpn',codec:'aac'}]},{id:702,number:2,audios:[{index:1,lang:'rus'},{index:3,lang:'jpn'}]}]}]}}); };
ctx.KP_API.mediaLinks=(mid,cb)=>{ requestedMid=mid; cb(null,{files:[{quality:'480p',url:{hls:base,hls2:'https://api.service-kp.com/default.m3u8'}}]}); };
const action=ctx.KP_UI.actions.play({id:18009,video:1,season:1,mid:999});
assert.ok(action.startsWith('content:request:interaction:audio:'));
function request(action) { const dataId=action.split('request:interaction:')[1].split('@')[0]; handler.handleRequest(dataId,{},v=>{result=v;}); }
request(action);
assert.equal(result.pages[0].items.length,2);
assert.match(result.pages[0].items[1].label,/JPN/);
assert.ok(result.pages[0].items[1].action.startsWith('video:resolve:'));
request(result.pages[0].items[1].action);
assert.equal(requestedMid,701,'resolve the actual episode, never trust stale UI media id');
assert.equal(result.url,base.replace('a1.m3u8','a2.m3u8'));
request(ctx.KP_UI.actions.play({id:18009,video:2,season:1}));
request(result.pages[0].items[1].action);
assert.equal(requestedMid,702);
assert.equal(result.url,base.replace('a1.m3u8','a3.m3u8'),'use API index, not array position');
const nativeAction='video:resolve:request:interaction:native:'+encodeURIComponent(JSON.stringify({id:18009,video:1,season:1,audio:2}))+'@unused';
ctx.KP_API.mediaLinks=(mid,cb)=>cb(null,{files:[{quality:'480p',url:{hls2:'https://api.service-kp.com/default.m3u8'}}]});
request(nativeAction);
assert.equal(result,null,'missing selected-language stream must not play Russian fallback');
assert.equal(failed,1);
for (const url of ['https://evil.test/master-v1a1.m3u8','https://cdntogo.net.evil.test/master-v1a1.m3u8','https://user:password@cdntogo.net/master-v1a1.m3u8','http://cdntogo.net/master-v1a1.m3u8','javascript:alert(1)']) assert.equal(ctx.KP_NATIVE.trusted(url),false);
assert.throws(()=>ctx.KP_NATIVE.stream([{url:{hls:base}}],'2/evil',{}));
console.log('Native MSX routing checks passed: episode resolution, real audio index, signed URL preservation, no wrong-language fallback, trusted hosts.');
