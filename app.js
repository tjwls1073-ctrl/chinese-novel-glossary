const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let mode="url",entries=[],projectName="";
const guide=`[중국 웹소설 번역 지침]

1. 중국어 고유명사는 반드시 원문의 한자를 확인한 뒤 한국 한자음으로 옮긴다.
2. 중국어 병음이나 중국식 발음을 한글로 음역하지 않는다.
3. 인명·지명·문파·조직·세력은 용어집 표기를 일관되게 사용한다.
4. 원문의 의미와 분위기를 살리되 자연스러운 한국 웹소설 문체로 번역한다.
5. 내용을 임의로 추가하거나 삭제하지 않는다.
6. 대사와 서술의 줄바꿈 구조를 가능한 한 유지한다.`;

const API_KEY_STORAGE="cng_gemini_api_key";
const savedApiKey=localStorage.getItem(API_KEY_STORAGE)||"";
if(savedApiKey){
  $("#apiKey").value=savedApiKey;
  $("#rememberApiKey").checked=true;
}
$("#toggleApiKey").onclick=()=>{
  const input=$("#apiKey");
  const show=input.type==="password";
  input.type=show?"text":"password";
  $("#toggleApiKey").textContent=show?"숨기기":"보기";
  $("#toggleApiKey").setAttribute("aria-label",show?"API 키 숨기기":"API 키 표시");
};
$("#rememberApiKey").onchange=()=>{
  if(!$("#rememberApiKey").checked)localStorage.removeItem(API_KEY_STORAGE);
};

$$(".tab").forEach(b=>b.onclick=()=>{
 mode=b.dataset.mode;
 $$(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");
 $("#urlPanel").classList.toggle("active",mode==="url");
 $("#textPanel").classList.toggle("active",mode==="text")
});
function setStatus(t,c=""){
 const e=$("#status");
 e.textContent=t;
 e.className="status "+c;
}
let toastTimer;
function showToast(message){
 const el=$("#toast");
 if(!el)return;
 el.textContent=message;
 el.classList.add("show");
 clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>el.classList.remove("show"),2200);
}
const GLOSSARY_STORAGE="cng_project_glossaries_v1";
function getStore(){
  try{
    const current=localStorage.getItem(GLOSSARY_STORAGE);
    if(current)return JSON.parse(current);
    const legacy=localStorage.getItem("cng_v3")||localStorage.getItem("cng_v2");
    const parsed=legacy?JSON.parse(legacy):{};
    localStorage.setItem(GLOSSARY_STORAGE,JSON.stringify(parsed));
    return parsed;
  }catch{return{}}
}
function saveStore(x){localStorage.setItem(GLOSSARY_STORAGE,JSON.stringify(x));renderSaved()}
function visible(filter="all"){return entries.filter(x=>["person","place"].includes(x.cat)&&(filter==="all"||x.cat===filter))}
function format(filter="all"){
 const list=visible(filter);
 return "[고유명사 표기표]\n\n"+list.map(x=>`${x.src} = ${x.ko}`).join("\n")+
 "\n\n원문에서 위 고유명사가 등장하면 반드시 지정된 한국 한자음 표기를 사용한다.\n표에 없는 중국어 고유명사도 원문 한자를 확인한 뒤 한국 한자음으로 변환한다."
}
function refresh(filter="all"){
 $("#output").value=format(filter);
 $("#count").textContent=visible().length;
 $("#promptBox").value=guide+"\n\n"+format()
}
$("#extract").onclick=async()=>{
 const apiKey=$("#apiKey").value.trim();
 const payload={mode,url:$("#url").value.trim(),text:$("#text").value.trim(),project:$("#project").value.trim(),model:$("#model").value.trim(),apiKey};
 if(!apiKey)return setStatus("Gemini API 키를 입력해 주세요.","error");
 if(!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey))return setStatus("Gemini API 키 형식을 확인해 주세요.","error");
 if($("#rememberApiKey").checked)localStorage.setItem(API_KEY_STORAGE,apiKey);
 else localStorage.removeItem(API_KEY_STORAGE);
 if(mode==="url"&&!payload.url)return setStatus("URL을 입력해 주세요.","error");
 if(mode==="text"&&payload.text.length<50)return setStatus("본문을 조금 더 길게 붙여넣어 주세요.","error");
 if(payload.project&&$("#mergeExisting").checked){
   const old=getStore()[payload.project];
   if(old)payload.existing=(old.entries||[]).filter(x=>["person","place"].includes(x.cat))
 }
 const btn=$("#extract");btn.disabled=true;
 btn.textContent="본문 수집 중…";
 setStatus("1/3 본문을 불러오고 있습니다.");
 const phaseTimer=setTimeout(()=>{
   btn.textContent="Gemini 분석 중…";
   setStatus("2/3 인물과 지명·세력을 분석하고 있습니다.");
 },900);
 try{
  const r=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"요청에 실패했습니다.");
  entries=(d.entries||[]).filter(x=>["person","place"].includes(x.cat));
  projectName=payload.project||d.pageTitle||"고유명사 표기표";
  $("#resultTitle").textContent=projectName;refresh();
  $("#resultCard").classList.remove("hidden");
  setStatus("3/3 용어집 정리가 완료되었습니다.","ok");showToast("용어집 추출이 완료됐어요");
  $("#resultCard").scrollIntoView({behavior:"smooth",block:"start"})
 }catch(e){
   setStatus(e.message||"오류가 발생했습니다.","error");
   showToast("추출 중 오류가 발생했어요");
 }finally{
   clearTimeout(phaseTimer);
   btn.disabled=false;
   btn.textContent="용어집 추출 시작";
 }
};
$$(".filter").forEach(b=>b.onclick=()=>{
 $$(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");refresh(b.dataset.filter)
});
$("#copy").onclick=async()=>{await navigator.clipboard.writeText($("#output").value);setStatus("콜로모용 용어집을 복사했어요.","ok");showToast("클립보드에 복사했어요")};
$("#copyPrompt").onclick=async()=>{await navigator.clipboard.writeText($("#promptBox").value);setStatus("용어집과 번역 지침을 복사했어요.","ok");showToast("용어집과 번역 지침을 복사했어요")};
$("#save").onclick=()=>{
 const name=($("#project").value.trim()||projectName||"").trim();
 if(!name)return setStatus("먼저 작품명을 입력해 주세요.","error");
 const all=getStore();
 const previous=(all[name]?.entries||[]).filter(x=>["person","place"].includes(x.cat));
 const merged=new Map();
 [...previous,...entries].forEach(x=>{if(x?.src&&x?.ko)merged.set(x.src,x)});
 all[name]={
   name,
   entries:[...merged.values()],
   updatedAt:new Date().toISOString()
 };
 saveStore(all);
 $("#project").value=name;
 setStatus(`‘${name}’ 용어집에 ${all[name].entries.length}개를 저장했어요.`,"ok");showToast("작품별 용어집에 저장했어요");
};
$("#download").onclick=()=>{
 const blob=new Blob([$("#output").value],{type:"text/plain;charset=utf-8"}),a=document.createElement("a");
 a.href=URL.createObjectURL(blob);a.download=(projectName||"용어집").replace(/[\\/:*?"<>|]/g,"_")+".txt";a.click();URL.revokeObjectURL(a.href)
};
$("#clear").onclick=()=>{
 if(confirm("저장된 작품별 용어집을 모두 삭제할까요?")){
   localStorage.removeItem(GLOSSARY_STORAGE);
   localStorage.removeItem("cng_v3");
   localStorage.removeItem("cng_v2");
   renderSaved();
   setStatus("저장된 용어집을 모두 삭제했어요.","ok");
 }
};
function renderSaved(){
 const box=$("#saved");
 const list=Object.entries(getStore()).sort((a,b)=>(b[1].updatedAt||"").localeCompare(a[1].updatedAt||""));
 box.innerHTML="";
 if(!list.length){
   box.innerHTML='<div class="empty-state"><strong>저장된 작품이 없어요.</strong><span>용어집을 만든 뒤 ‘작품에 저장’을 눌러 주세요.</span></div>';
   return;
 }
 for(const [name,item] of list){
   const clean=(item.entries||[]).filter(x=>["person","place"].includes(x.cat));
   const el=document.createElement("div");
   el.className="saved-item";
   el.innerHTML=`<div class="saved-main"><strong></strong><small>${clean.length}개 · ${new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small></div><div class="saved-actions"><button type="button" data-open>열기</button><button type="button" class="danger" data-del>삭제</button></div>`;
   el.querySelector("strong").textContent=name;
   el.querySelector("[data-open]").onclick=()=>{
     entries=clean;
     projectName=name;
     $("#project").value=name;
     $("#resultTitle").textContent=name;
     refresh();
     $("#resultCard").classList.remove("hidden");
     $("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
     setStatus(`‘${name}’ 용어집을 열었어요.`,"ok");
   };
   el.querySelector("[data-del]").onclick=()=>{
     if(confirm(`‘${name}’ 용어집을 삭제할까요?`)){
       const all=getStore();
       delete all[name];
       saveStore(all);
       setStatus(`‘${name}’ 용어집을 삭제했어요.`,"ok");showToast("용어집을 삭제했어요");
     }
   };
   box.appendChild(el);
 }
}
renderSaved();