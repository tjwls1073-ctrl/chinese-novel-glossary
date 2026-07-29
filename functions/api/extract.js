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
function makePrompt(text,existing){
  return `중국어로 쓰인 웹소설 본문에서 번역용 고유명사를 추출해 JSON으로 출력하라.

반드시 다음 JSON 형식만 출력:
{"entries":[{"src":"原文漢字","ko":"자연스러운 한국어 표기","cat":"person"}]}

cat 값:
- person: 인명, 성명, 자, 호, 별칭
- place: 지명, 국가, 도시, 산천, 가문, 문파, 종문, 조직, 세력
- term: 관직, 직책, 공법, 무공, 술법, 무기, 법보, 영물, 괴담, 던전, 시스템 고유명

작업 절차:
1. 먼저 본문에 나타난 작품의 배경을 판단한다.
   배경의 예시는 중국 현대, 중국 고대, 무협, 선협, 서양 판타지, 일본, 현대 혼합 세계관이다.

2. 작품 배경과 이름 주변 문맥을 함께 참고하여 각 고유명사가 다음 중 무엇인지 먼저 판단한다.
   - 실제 중국식 고유명사
   - 중국어로 음차된 외국·서양·판타지식 고유명사
   - 일본식 고유명사
   - 뜻을 번역해야 자연스러운 기술·직책·아이템 이름

3. 한자 모양만 보고 모든 이름을 한국 한자음으로 처리하지 않는다.

표기 규칙:
1. src에는 원문의 중국 한자를 그대로 보존한다.

2. 실제 중국 인명·지명·문파·조직은 자연스러운 한국 한자음으로 표기한다.
   예:
   - 张三 → 장삼
   - 李青 → 이청

3. 중국어로 음차된 서양·외국 인명과 지명은 원래 발음을 최대한 복원하여 한국어 외래어 표기로 적는다.

4. 외국 이름을 한자별 한국 한자음으로 기계적으로 읽지 않는다.
   예:
   - 丹尼尔 → 다니엘 (단니이 금지)
   - 威尔逊 → 윌슨 (위이손 금지)
   - 亨利 → 헨리 (형리 금지)
   - 克里斯 → 크리스 (극리사 금지)
   - 亚历山大 → 알렉산더 (아력산대 금지)
   - 克劳德 → 클라우드
   - 克莱恩 → 클라인
   - 凯文 → 케빈
   - 杰克 → 잭
   - 乔治 → 조지
   - 汤姆 → 톰
   - 露西 → 루시
   - 艾伦 → 앨런
   - 艾米 → 에이미
   - 维多利亚 → 빅토리아

5. 서양 판타지나 외국 고유명사의 원래 철자와 발음을 정확히 특정할 수 없다면, 중국어 발음과 주변 문맥을 참고하여 한국어 독자가 가장 자연스럽게 읽을 수 있는 표기를 사용한다.
   예:
   - 克孜斯奈尔 → 크즈스나엘
   - 극자사내이처럼 한국 한자음을 기계적으로 이어 붙이지 않는다.

6. 일본 인명·지명으로 판단되면 한국 한자음이 아니라 일본식 독음을 사용한다.

7. 뜻이 명확한 직책·기술·공법·무기·아이템은 무조건 한자음으로 읽지 말고 한국어 독자가 이해하기 자연스럽게 처리한다. 단, 고유명으로서의 성격은 유지한다.

8. 일반 명사, 대명사, 단순 호칭, 광고, 메뉴, 사이트 문구는 제외한다.

9. 이름으로 확신하기 어려운 항목은 억지로 포함하지 않는다.

10. 동일한 항목은 중복해서 출력하지 않는다.

11. 기존 용어집은 표기의 일관성을 위한 참고 자료로 사용한다.

12. 기존 용어집에 외국 음차명을 다음처럼 한국 한자음으로 기계 변환한 오류가 있다면 기존 표기를 그대로 따르지 말고 자연스러운 외래어 표기로 바로잡는다.
   잘못된 예:
   - 단니이
   - 위이손
   - 형리
   - 극리사
   - 극자사내이

13. 기존 표기가 문맥상 올바르고 자연스럽다면 그대로 유지한다.

기존 용어집:
${JSON.stringify(existing)}

본문:
${text}`;
}
