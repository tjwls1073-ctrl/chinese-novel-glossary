const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let mode="url", rawEntries=[], currentProject="";
const basePrompt=`[중국 웹소설 번역 지침]

1. 중국어 고유명사는 반드시 원문의 한자를 확인한 뒤 한국 한자음으로 옮긴다.
2. 중국어 병음이나 중국식 발음을 한글로 음역하지 않는다.
3. 인명·지명·문파·세력·공법·법보 등은 용어집 표기를 일관되게 사용한다.
4. 원문의 의미와 분위기를 살리되 자연스러운 한국 웹소설 문체로 번역한다.
5. 내용을 임의로 추가하거나 삭제하지 않는다.
6. 대사와 서술의 줄바꿈 구조를 가능한 한 유지한다.`;

$$(".tab").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;$$(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#urlPanel").classList.toggle("active",mode==="url");$("#textPanel").classList.toggle("active",mode==="text")});
function status(t,c=""){let e=$("#status");e.textContent=t;e.className="status "+c}
function store(){try{return JSON.parse(localStorage.getItem("cng_v2")||"{}")}catch{return{}}}
function persist(x){localStorage.setItem("cng_v2",JSON.stringify(x));renderSaved()}
function parseGlossary(text){
  const arr=[];
  let cat="term";
  for(const line of String(text).split("\n")){
    const t=line.trim();
    if(/^##?\s*인물/.test(t)||t==="[인물]")cat="person";
    else if(/지명|세력|조직|문파/.test(t)&&!t.includes("="))cat="place";
    else if(/기타|용어|공법|법보/.test(t)&&!t.includes("="))cat="term";
    else{
      const m=t.match(/^([^=]{1,60})\s*=\s*([^=]{1,60})$/);
      if(m)arr.push({src:m[1].trim(),ko:m[2].trim(),cat});
    }
  }
  const seen=new Set();return arr.filter(x=>{const k=x.src+"="+x.ko;if(seen.has(k))return false;seen.add(k);return true})
}
function format(entries, filter="all"){
  const chosen=filter==="all"?entries:entries.filter(x=>x.cat===filter);
  return "[고유명사 표기표]\n\n"+chosen.map(x=>`${x.src} = ${x.ko}`).join("\n")+"\n\n원문에서 위 고유명사가 등장하면 반드시 지정된 한국 한자음 표기를 사용한다.\n표에 없는 중국어 고유명사도 원문 한자를 확인한 뒤 한국 한자음으로 변환한다.";
}
function refresh(filter="all"){
  $("#output").value=format(rawEntries,filter);$("#count").textContent=rawEntries.length+"개";
  $("#promptBox").value=basePrompt+"\n\n"+format(rawEntries);
}
$("#extract").onclick=async()=>{
  const payload={mode,url:$("#url").value.trim(),text:$("#text").value.trim(),project:$("#project").value.trim(),model:$("#model").value.trim()};
  if(mode==="url"&&!payload.url)return status("URL을 입력해 주세요.","error");
  if(mode==="text"&&payload.text.length<50)return status("본문을 조금 더 길게 붙여넣어 주세요.","error");
  const old=$("#extract").textContent;$("#extract").disabled=true;$("#extract").textContent="추출 중…";status("본문과 고유명사를 분석하고 있습니다.");
  try{
    if(payload.project&&$("#mergeExisting").checked){
      const saved=store()[payload.project]; if(saved)payload.existing=saved.entries;
    }
    const r=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"요청 실패");
    rawEntries=Array.isArray(d.entries)?d.entries:parseGlossary(d.glossary||"");
    currentProject=payload.project||d.pageTitle||"고유명사 표기표";
    $("#resultTitle").textContent=currentProject;refresh();$("#resultCard").classList.remove("hidden");status("용어집을 만들었습니다.","ok");$("#resultCard").scrollIntoView({behavior:"smooth"});
  }catch(e){status(e.message||"오류가 발생했습니다.","error")}finally{$("#extract").disabled=false;$("#extract").textContent=old}
};
$$(".mini").forEach(b=>b.onclick=()=>{$$(".mini").forEach(x=>x.classList.remove("active"));b.classList.add("active");refresh(b.dataset.filter)});
$("#copy").onclick=async()=>{await navigator.clipboard.writeText($("#output").value);status("콜로모용 용어집을 복사했습니다.","ok")};
$("#copyPrompt").onclick=async()=>{await navigator.clipboard.writeText($("#promptBox").value);status("용어집과 번역 지침을 함께 복사했습니다.","ok")};
$("#save").onclick=()=>{
 const name=$("#project").value.trim()||currentProject||prompt("작품명을 입력하세요.");if(!name)return;
 const all=store(),existing=all[name]?.entries||[],map=new Map();
 [...existing,...rawEntries].forEach(x=>map.set(x.src,x));all[name]={entries:[...map.values()],updatedAt:new Date().toISOString()};persist(all);status(`‘${name}’에 저장했습니다.`,"ok")
};
$("#download").onclick=()=>{const b=new Blob([$("#output").value],{type:"text/plain;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=(currentProject||"용어집").replace(/[\\/:*?"<>|]/g,"_")+".txt";a.click();URL.revokeObjectURL(a.href)};
$("#clear").onclick=()=>{if(confirm("저장된 용어집을 모두 삭제할까요?")){localStorage.removeItem("cng_v2");renderSaved()}};
function renderSaved(){
 const box=$("#saved"),entries=Object.entries(store()).sort((a,b)=>b[1].updatedAt.localeCompare(a[1].updatedAt));box.innerHTML="";
 if(!entries.length){box.innerHTML='<div class="empty">저장된 작품이 없습니다.</div>';return}
 for(const [name,item] of entries){const d=document.createElement("div");d.className="savedItem";d.innerHTML=`<div><strong></strong><small>${item.entries.length}개 · ${new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small></div><div class="savedBtns"><button data-open>열기</button><button data-del>삭제</button></div>`;d.querySelector("strong").textContent=name;d.querySelector("[data-open]").onclick=()=>{rawEntries=item.entries;currentProject=name;$("#project").value=name;$("#resultTitle").textContent=name;refresh();$("#resultCard").classList.remove("hidden");$("#resultCard").scrollIntoView({behavior:"smooth"})};d.querySelector("[data-del]").onclick=()=>{if(confirm(`‘${name}’을 삭제할까요?`)){const a=store();delete a[name];persist(a)}};box.appendChild(d)}
}
renderSaved();