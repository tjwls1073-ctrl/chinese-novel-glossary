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
function makePrompt(text, existing) {
  return `중국어로 쓰인 웹소설 본문에서 번역에 필요한 고유명사를 추출하여 JSON으로 출력하라.

반드시 아래 JSON 형식만 출력한다.
설명, 코드블록, 주석, 부가 문장은 출력하지 않는다.

{"entries":[{"src":"原文漢字","ko":"자연스러운 한국어 표기","cat":"person"}]}

cat 분류:
- person: 인명, 성명, 자, 호, 별명, 코드명
- place: 지명, 국가, 도시, 산천, 가문, 문파, 종문, 조직, 세력
- term: 직책, 관직, 공법, 무공, 술법, 무기, 법보, 영물, 괴담, 던전, 시스템 고유명

[최우선 판단 절차]

1. 먼저 작품의 전체 배경을 판단한다.
   예:
   - 중국 현대
   - 중국 고대
   - 무협
   - 선협
   - 서양 판타지
   - 일본
   - 현대 판타지
   - 혼합 세계관

2. 각 고유명사는 이름 주변의 문맥과 세계관을 확인하여 다음 중 하나로 분류한다.

   A. 실제 중국식 인명·지명·조직명
   B. 중국어로 음차된 외국·서양·판타지 고유명사
   C. 일본식 고유명사
   D. 의미를 가진 별명·코드명
   E. 기술·직책·아이템·조직 등의 명칭

3. 한자 모양만 보고 표기를 결정하지 않는다.

[실제 중국식 고유명사]

1. 실제 중국식 인명·지명·문파·조직은 한국 한자음으로 표기한다.

2. 실제 중국식 이름을 중국어 병음이나 중국식 발음으로 한글 음역하지 않는다.

예:
- 张三 → 장삼
- 李青 → 이청
- 夏常笑 → 하상소
- 除炫 → 제현
- 加三 → 가삼

금지:
- 张三 → 장싼
- 李青 → 리칭
- 夏常笑 → 샤창샤오
- 除炫 → 추현
- 加三 → 가산

3. 각 한자의 표준 한국 한자음을 확인한다.
   중국어 발음과 비슷하다는 이유로 임의의 한국어 음을 사용하지 않는다.

4. 두음법칙이 적용되는 이름은 한국어 인명 표기로 자연스럽게 처리한다.
   단, 작품 전체에서 사용 중인 표기가 있으면 일관성을 유지한다.

[외국·서양·판타지 고유명사]

1. 중국어로 음차된 외국·서양·판타지 이름은 한국 한자음으로 읽지 않는다.

2. 가능한 경우 원래 이름이나 발음을 복원하여 자연스러운 한국어 외래어 표기로 적는다.

예:
- 丹尼尔 → 다니엘
- 威尔逊 → 윌슨
- 亨利 → 헨리
- 克里斯 → 크리스
- 亚历山大 → 알렉산더
- 凯文 → 케빈
- 杰克 → 잭
- 乔治 → 조지
- 露西 → 루시
- 艾伦 → 앨런

금지:
- 丹尼尔 → 단니이
- 威尔逊 → 위이손
- 亨利 → 형리
- 克里斯 → 극리사
- 亚历山大 → 아력산대

3. 원래 철자와 발음을 정확히 특정할 수 없는 판타지 이름은 중국어 발음과 주변 문맥을 참고하여 한국 독자가 자연스럽게 읽을 수 있는 표기로 옮긴다.

예:
- 克孜斯奈尔 → 크즈스나엘

금지:
- 克孜斯奈尔 → 극자사내이

4. 외국 이름을 한국 한자음으로 읽지 말라는 규칙은 실제 외국 음차명에만 적용한다.
   이 규칙을 실제 중국식 이름에 확대 적용하지 않는다.

[일본식 고유명사]

1. 일본 작품, 일본인, 일본 지명으로 판단되면 한국 한자음이 아니라 일본식 독음을 사용한다.

2. 중국식 이름인지 일본식 이름인지 불분명하면 작품 배경과 주변 문맥을 우선 확인한다.

[별명·코드명]

1. 뜻이 명확한 별명이나 코드명은 정식 인명처럼 무조건 한자음으로 읽지 않는다.

2. 별명의 의미가 중요한 경우 자연스러운 한국어 뜻으로 번역한다.

예:
- 嫩芽가 별명·코드명이면 → 새싹
- 海鸥가 별명·코드명이면 → 갈매기

3. 작품에서 한자음 이름처럼 고정적으로 사용하는 별명이라면 한자음 표기를 유지할 수 있다.

4. 의미 번역과 한자음 표기 중 무엇이 적절한지 문맥으로 판단한다.

[기타 명칭]

1. 지명, 세력, 문파, 조직명은 작품 배경에 맞게 처리한다.

2. 기술, 직책, 공법, 무기, 아이템은 무조건 한자음으로만 읽지 않는다.
   의미가 중요한 명칭은 자연스러운 한국어로 번역하되 고유명 성격을 유지한다.

3. 일반 명사, 대명사, 단순 호칭, 광고, 메뉴, 사이트 문구는 제외한다.

4. 이름인지 확신할 수 없는 항목은 억지로 포함하지 않는다.

5. 동일한 항목은 중복해서 출력하지 않는다.

[기존 용어집 처리]

1. 기존 용어집은 작품 내 표기 일관성을 위한 참고 자료다.

2. 기존 표기가 자연스럽고 올바르면 그대로 유지한다.

3. 기존 용어집에 명백한 기계 변환이나 병음식 오류가 있으면 그대로 따르지 않고 바로잡는다.

잘못된 기존 표기의 예:
- 夏常笑 = 샤창샤오
- 除炫 = 추현
- 加三 = 가산
- 丹尼尔 = 단니이
- 威尔逊 = 위이손
- 克里斯 = 극리사
- 克孜斯奈尔 = 극자사내이

올바른 처리 예:
- 夏常笑 = 하상소
- 除炫 = 제현
- 加三 = 가삼
- 丹尼尔 = 다니엘
- 威尔逊 = 윌슨
- 克里斯 = 크리스
- 克孜斯奈尔 = 크즈스나엘

기존 용어집:
${JSON.stringify(existing)}

본문:
${text}`;
}
