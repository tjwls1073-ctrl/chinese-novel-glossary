const MAX_HTML=2_000_000,MAX_TEXT=80_000;
export async function onRequestPost({request,env}){
 try{
  const b=await request.json(),model=cleanModel(b.model||env.GEMINI_MODEL||"gemini-3.1-flash-lite");
  let text="",pageTitle="";
  if(b.mode==="text")text=String(b.text||"");
  else{const u=validUrl(b.url),p=await fetchPage(u);pageTitle=title(p);text=htmlText(p)}
  text=text.replace(/\s+/g," ").trim().slice(0,MAX_TEXT);
  if(text.length<50)return js({error:"본문을 충분히 가져오지 못했습니다. 본문 붙여넣기를 사용해 주세요."},422);
  if(!env.GEMINI_API_KEY)return js({error:"Cloudflare Secret에 GEMINI_API_KEY를 등록해 주세요."},500);
  const existing=Array.isArray(b.existing)?b.existing.slice(0,1000):[];
  const prompt=makePrompt(text,existing);
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.05,maxOutputTokens:8192,responseMimeType:"application/json"}})});
  const d=await r.json().catch(()=>({}));if(!r.ok)return js({error:d?.error?.message||`Gemini API 오류 (${r.status})`},502);
  const out=d?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("").trim();if(!out)return js({error:"Gemini 응답이 비어 있습니다."},502);
  let parsed;try{parsed=JSON.parse(out)}catch{parsed={entries:[]}}
  let entries=Array.isArray(parsed.entries)?parsed.entries:[];
  entries=entries.map(x=>({src:String(x.src||"").trim(),ko:String(x.ko||"").trim(),cat:["person","place","term"].includes(x.cat)?x.cat:"term"})).filter(x=>x.src&&x.ko&&/[\u3400-\u9fff]/.test(x.src)&&x.src.length<=60&&x.ko.length<=60);
  const map=new Map();[...existing,...entries].forEach(x=>map.set(x.src,x));
  return js({entries:[...map.values()],pageTitle,model});
 }catch(e){return js({error:e?.message||"서버 오류"},500)}
}
function js(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json;charset=UTF-8","Cache-Control":"no-store"}})}
function cleanModel(v){v=String(v).trim();if(!/^[\w.-]{3,80}$/.test(v))throw Error("모델 이름이 올바르지 않습니다.");return v}
function validUrl(raw){let u;try{u=new URL(String(raw))}catch{throw Error("올바른 URL을 입력해 주세요.")}if(!["http:","https:"].includes(u.protocol))throw Error("http/https 주소만 가능합니다.");const h=u.hostname.toLowerCase();if(h==="localhost"||h.endsWith(".local")||privateIp(h))throw Error("내부 네트워크 주소는 사용할 수 없습니다.");u.username="";u.password="";return u}
function privateIp(h){if(/^\d+\.\d+\.\d+\.\d+$/.test(h)){const[a,b]=h.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)}return h==="::1"||h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe80")}
async function fetchPage(u){const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(u.toString(),{redirect:"follow",signal:c.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","Accept":"text/html,application/xhtml+xml"}});if(!r.ok)throw Error(`웹페이지를 불러오지 못했습니다 (${r.status}).`);const ct=r.headers.get("content-type")||"";if(!/text\/html|application\/xhtml\+xml/.test(ct))throw Error("HTML 페이지가 아닙니다.");const ab=await r.arrayBuffer();if(ab.byteLength>MAX_HTML)throw Error("페이지가 너무 큽니다.");const cs=/charset=([^;]+)/i.exec(ct)?.[1]?.trim()||"utf-8";try{return new TextDecoder(cs).decode(ab)}catch{return new TextDecoder("utf-8").decode(ab)}}finally{clearTimeout(t)}}
function title(h){const m=h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);return ent((m?.[1]||"").replace(/<[^>]+>/g," ").trim()).slice(0,120)}
function htmlText(h){return ent(h.replace(/<!--[\s\S]*?-->/g," ").replace(/<(script|style|noscript|svg|canvas|iframe|form|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|article|section|li|h[1-6])>/gi,"\n").replace(/<[^>]+>/g," ")).replace(/\s+/g," ")}
function ent(s){const m={"&nbsp;":" ","&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"};return s.replace(/&(nbsp|amp|lt|gt|quot|#39);/gi,x=>m[x.toLowerCase()]||x).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))}
function makePrompt(text,existing){return `중국 웹소설 본문에서 번역용 고유명사를 추출해 JSON으로 출력하라.

반드시 다음 JSON 형식만 출력:
{"entries":[{"src":"原文漢字","ko":"한국한자음","cat":"person"}]}

cat 값:
- person: 인명, 성명, 자, 호, 별칭
- place: 지명, 국가, 도시, 산천, 가문, 문파, 종문, 조직, 세력
- term: 관직, 직책, 공법, 무공, 술법, 무기, 법보, 영물, 괴담, 던전, 시스템 고유명

최우선 규칙:
1. src는 원문의 중국 한자를 그대로 보존한다.
2. ko는 각 한자의 한국 한자음만 사용한다.
3. 중국어 병음 및 중국식 발음의 한글 음역을 절대 사용하지 않는다.
4. 뜻풀이 번역을 하지 않는다.
5. 성씨도 한국 한자음으로 읽는다.
6. 일반 명사, 대명사, 단순 호칭, 광고·메뉴는 제외한다.
7. 확신이 낮은 항목은 제외한다.
8. 기존 용어집에 있는 src는 기존 ko와 cat을 그대로 유지한다.
9. 중복을 제거한다.

기존 용어집:
${JSON.stringify(existing)}

본문:
${text}`}

