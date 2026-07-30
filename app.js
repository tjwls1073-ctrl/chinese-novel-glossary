(() => {
  "use strict";
  const STORAGE_KEY = "novel-person-glossary-v2";
  const SETTINGS_KEY = "novel-person-glossary-settings-v2";
  const DEFAULT_MODEL = "gemini-3.1-flash-lite";
  const $ = (id) => document.getElementById(id);
  const el = {
    projectSelect: $("projectSelect"), projectMeta: $("projectMeta"), newProjectName: $("newProjectName"),
    addProjectBtn: $("addProjectBtn"), renameProjectBtn: $("renameProjectBtn"), deleteProjectBtn: $("deleteProjectBtn"),
    urlInput: $("urlInput"), fetchBtn: $("fetchBtn"), pageInfo: $("pageInfo"), sourceText: $("sourceText"),
    charCount: $("charCount"), clearTextBtn: $("clearTextBtn"), apiKey: $("apiKey"), saveApiKey: $("saveApiKey"),
    model: $("model"), extractBtn: $("extractBtn"), status: $("status"), entrySearch: $("entrySearch"),
    sortMode: $("sortMode"), entryCount: $("entryCount"), emptyState: $("emptyState"),
    entryTableWrap: $("entryTableWrap"), entryList: $("entryList"), manualEntryForm: $("manualEntryForm"),
    manualSource: $("manualSource"), manualKorean: $("manualKorean"), copyBtn: $("copyBtn"),
    downloadTxtBtn: $("downloadTxtBtn"), backupBtn: $("backupBtn"), restoreBtn: $("restoreBtn"),
    restoreInput: $("restoreInput"), includeHeader: $("includeHeader"), chapterHistory: $("chapterHistory")
  };

  let state = loadState();
  let currentPage = { url: "", title: "", bookTitle: "" };
  ensureProject(); loadSettings(); bind(); renderAll(); countChars();

  function bind() {
    el.projectSelect.onchange = () => { state.activeProjectId = el.projectSelect.value; currentPage = {url:"",title:"",bookTitle:""}; save(); renderAll(); hideStatus(); };
    el.addProjectBtn.onclick = createProject;
    el.newProjectName.onkeydown = (e) => { if (e.key === "Enter") createProject(); };
    el.renameProjectBtn.onclick = renameProject;
    el.deleteProjectBtn.onclick = deleteProject;
    el.fetchBtn.onclick = fetchChapter;
    el.urlInput.onkeydown = (e) => { if (e.key === "Enter") fetchChapter(); };
    el.sourceText.oninput = countChars;
    el.clearTextBtn.onclick = () => { if (!el.sourceText.value || confirm("현재 원문을 비울까요?")) { el.sourceText.value=""; currentPage={url:"",title:"",bookTitle:""}; el.pageInfo.hidden=true; countChars(); } };
    el.extractBtn.onclick = extractNames;
    el.saveApiKey.onchange = saveSettings; el.apiKey.onchange = saveSettings; el.model.onchange = saveSettings;
    el.entrySearch.oninput = renderEntries; el.sortMode.onchange = renderEntries;
    el.entryList.onchange = editEntry; el.entryList.onclick = deleteEntry;
    el.manualEntryForm.onsubmit = addManual;
    el.copyBtn.onclick = copyGlossary; el.downloadTxtBtn.onclick = downloadTxt;
    el.backupBtn.onclick = backup; el.restoreBtn.onclick = () => el.restoreInput.click(); el.restoreInput.onchange = restore;
  }

  function id() { return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function clean(v, max=200) { return String(v ?? "").replace(/[\u0000-\u001F\u007F]+/g," ").replace(/\s+/g," ").trim().slice(0,max); }
  function goodDate(v) { return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : ""; }
  function normName(v) { return clean(v,100).normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s《》〈〉「」『』【】()[\]_-]+/g,""); }
  function normSearch(v) { return String(v ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").trim(); }
  function cleanUrl(v) { try { const u=new URL(String(v??"").trim()); if(!["http:","https:"].includes(u.protocol)) return ""; u.hash=""; return u.toString(); } catch { return ""; } }
  function now() { return new Date().toISOString(); }
  function makeProject(name) { const t=now(); return {id:id(),name:clean(name,80)||"새 작품",entries:[],chapters:[],createdAt:t,updatedAt:t}; }
  function defaultState() { const p=makeProject("새 작품"); return {version:2,activeProjectId:p.id,projects:[p]}; }

  function normalizeProject(p) {
    if(!p || typeof p!=="object") return null;
    const t=now(), seen=new Set();
    const entries=(Array.isArray(p.entries)?p.entries:[]).map(x=>{
      const source=clean(x?.source,40), korean=clean(x?.korean,60); if(!source||!korean||seen.has(source)) return null; seen.add(source);
      return {id:clean(x?.id,100)||id(),source,korean,createdAt:goodDate(x?.createdAt)||t,updatedAt:goodDate(x?.updatedAt)||t};
    }).filter(Boolean);
    const chapters=(Array.isArray(p.chapters)?p.chapters:[]).map(x=>({url:cleanUrl(x?.url),title:clean(x?.title,180),processedAt:goodDate(x?.processedAt)||t})).filter(x=>x.url||x.title);
    return {id:clean(p.id,100)||id(),name:clean(p.name,80)||"이름 없는 작품",entries,chapters,createdAt:goodDate(p.createdAt)||t,updatedAt:goodDate(p.updatedAt)||t};
  }
  function loadState() { try { const x=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"); if(!x||!Array.isArray(x.projects)) return defaultState(); const ps=x.projects.map(normalizeProject).filter(Boolean); if(!ps.length) return defaultState(); return {version:2,activeProjectId:ps.some(p=>p.id===x.activeProjectId)?x.activeProjectId:ps[0].id,projects:ps}; } catch { return defaultState(); } }
  function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  function ensureProject(){if(!state.projects.length){const p=makeProject("새 작품");state.projects=[p];state.activeProjectId=p.id;save();}}
  function active(){return state.projects.find(p=>p.id===state.activeProjectId)||state.projects[0];}
  function loadSettings(){try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}");el.model.value=clean(s.model,80)||DEFAULT_MODEL;el.saveApiKey.checked=!!s.saveApiKey;el.apiKey.value=s.saveApiKey?clean(s.apiKey,300):"";}catch{el.model.value=DEFAULT_MODEL;}}
  function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify({model:clean(el.model.value,80)||DEFAULT_MODEL,saveApiKey:el.saveApiKey.checked,apiKey:el.saveApiKey.checked?clean(el.apiKey.value,300):""}));}

  function renderAll(){renderProjects();renderEntries();renderHistory();}
  function renderProjects(){const a=active();el.projectSelect.replaceChildren(...state.projects.map(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=p.name;o.selected=p.id===a.id;return o;}));renderMeta();}
  function renderMeta(){const p=active();el.projectMeta.textContent=`인명 ${p?.entries.length||0}개 · 회차 ${p?.chapters.length||0}개`;}
  function renderEntries(){
    const p=active(), q=normSearch(el.entrySearch.value), mode=el.sortMode.value; let xs=[...(p?.entries||[])];
    if(q) xs=xs.filter(x=>normSearch(x.source).includes(q)||normSearch(x.korean).includes(q));
    if(mode==="source") xs.sort((a,b)=>a.source.localeCompare(b.source,"zh-CN")); else if(mode==="korean") xs.sort((a,b)=>a.korean.localeCompare(b.korean,"ko-KR")); else xs.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
    el.entryList.replaceChildren(...xs.map(row)); const total=p?.entries.length||0; el.entryCount.textContent=q?`${xs.length}/${total}개`:`${total}개`; el.emptyState.hidden=total>0; el.entryTableWrap.hidden=total===0; renderMeta();
  }
  function row(x){
    const tr=document.createElement("tr");tr.dataset.id=x.id;
    const a=document.createElement("td"),b=document.createElement("td"),c=document.createElement("td");c.className="action-column";
    const i1=document.createElement("input");i1.value=x.source;i1.maxLength=40;i1.dataset.field="source";i1.ariaLabel="원문 이름";
    const i2=document.createElement("input");i2.value=x.korean;i2.maxLength=60;i2.dataset.field="korean";i2.ariaLabel="한국어 표기";
    const del=document.createElement("button");del.type="button";del.className="delete-entry";del.dataset.action="delete";del.textContent="×";del.ariaLabel=`${x.source} 삭제`;
    a.append(i1);b.append(i2);c.append(del);tr.append(a,b,c);return tr;
  }
  function renderHistory(){
    const xs=[...(active()?.chapters||[])].sort((a,b)=>Date.parse(b.processedAt)-Date.parse(a.processedAt));
    if(!xs.length){const p=document.createElement("p");p.className="history-empty";p.textContent="아직 처리한 회차가 없습니다.";el.chapterHistory.replaceChildren(p);return;}
    el.chapterHistory.replaceChildren(...xs.map(x=>{const d=document.createElement("div");d.className="history-item";let t;if(x.url){t=document.createElement("a");t.href=x.url;t.target="_blank";t.rel="noopener noreferrer";t.textContent=x.title||x.url;t.title=x.url;}else{t=document.createElement("span");t.className="history-title";t.textContent=x.title||"직접 붙여넣은 원문";}const date=document.createElement("span");date.className="history-date";date.textContent=formatDate(x.processedAt);d.append(t,date);return d;}));
  }

  function createProject(){const name=clean(el.newProjectName.value,80);if(!name){status("새 작품명을 입력해 주세요.",true);el.newProjectName.focus();return;}const dup=state.projects.find(p=>normName(p.name)===normName(name));if(dup){state.activeProjectId=dup.id;save();renderAll();status(`이미 있는 ‘${dup.name}’ 작품을 선택했습니다.`);return;}const p=makeProject(name);state.projects.push(p);state.activeProjectId=p.id;el.newProjectName.value="";currentPage={url:"",title:"",bookTitle:""};save();renderAll();status(`‘${p.name}’ 작품을 만들었습니다.`);}
  function renameProject(){const p=active();const v=prompt("새 작품명을 입력하세요.",p.name);if(v===null)return;const name=clean(v,80);if(!name){status("작품명은 비워둘 수 없습니다.",true);return;}if(state.projects.some(x=>x.id!==p.id&&normName(x.name)===normName(name))){status("같은 이름의 작품이 이미 있습니다.",true);return;}p.name=name;p.updatedAt=now();save();renderAll();status("작품명을 변경했습니다.");}
  function deleteProject(){const p=active();if(!confirm(`‘${p.name}’과 저장된 인명 ${p.entries.length}개를 삭제할까요?`))return;state.projects=state.projects.filter(x=>x.id!==p.id);ensureProject();state.activeProjectId=state.projects[0].id;save();renderAll();status("작품을 삭제했습니다.");}

  async function fetchChapter(){
    const url=cleanUrl(el.urlInput.value);if(!url){status("올바른 http 또는 https URL을 입력해 주세요.",true);return;}busy(el.fetchBtn,true,"불러오는 중…");status("회차 페이지에서 본문을 찾고 있습니다.");
    try{const data=await post("/api/fetch-url",{url});const text=String(data.text||"").trim();if(!text)throw new Error("본문을 찾지 못했습니다.");el.sourceText.value=text;countChars();currentPage={url:cleanUrl(data.finalUrl||url),title:clean(data.title,180),bookTitle:clean(data.bookTitle,80)};const matched=matchProject(currentPage);const parts=[currentPage.title||"제목을 확인하지 못한 페이지",`${text.length.toLocaleString("ko-KR")}자`];if(matched)parts.push(`‘${matched.name}’ 작품 자동 선택`);el.pageInfo.textContent=parts.join(" · ");el.pageInfo.hidden=false;status("본문을 불러왔습니다. 내용을 확인한 뒤 인명 추가 버튼을 눌러 주세요.");}
    catch(e){status(e.message||"URL을 불러오지 못했습니다.",true);}finally{busy(el.fetchBtn,false,"URL 불러오기");}
  }
  function matchProject(page){const u=cleanUrl(page.url);let p=state.projects.find(x=>x.chapters.some(c=>u&&cleanUrl(c.url)===u));if(!p&&page.bookTitle)p=state.projects.find(x=>normName(x.name)===normName(page.bookTitle));if(p){state.activeProjectId=p.id;save();renderAll();return p;}const a=active();if(page.bookTitle&&a.entries.length===0&&a.chapters.length===0&&normName(a.name)===normName("새 작품")){a.name=page.bookTitle;a.updatedAt=now();save();renderAll();return a;}return null;}

  async function extractNames(){
    const p=active(),text=el.sourceText.value.trim(),apiKey=clean(el.apiKey.value,300),model=clean(el.model.value,80)||DEFAULT_MODEL;if(text.length<20){status("분석할 중국어 원문을 입력해 주세요.",true);return;}saveSettings();busy(el.extractBtn,true,"인명을 찾는 중…");status(`‘${p.name}’의 기존 용어집과 비교하며 인명을 찾고 있습니다.`);
    try{const data=await post("/api/extract",{apiKey,model,text,existingEntries:p.entries.map(({source,korean})=>({source,korean}))});const people=Array.isArray(data.people)?data.people:[],map=new Map(p.entries.map(x=>[x.source,x]));let added=0,old=0;const t=now();for(const x of people){const source=clean(x?.source,40),korean=clean(x?.korean,60);if(!source||!korean)continue;if(map.has(source)){old++;continue;}const e={id:id(),source,korean,createdAt:t,updatedAt:t};p.entries.push(e);map.set(source,e);added++;}recordChapter(p);p.updatedAt=t;save();renderAll();if(added)status(`새 인명 ${added}개를 추가했습니다.${old?` 기존 인명 ${old}개는 유지했습니다.`:""}`);else if(people.length)status("이번 회차의 인명은 모두 기존 용어집에 이미 저장되어 있습니다.");else status("이번 원문에서 확실한 사람 이름을 찾지 못했습니다.");}
    catch(e){status(e.message||"인명 추출에 실패했습니다.",true);}finally{busy(el.extractBtn,false,"현재 작품에 인명 추가하기");}
  }
  function recordChapter(p){const t=now(),url=cleanUrl(currentPage.url||el.urlInput.value),title=clean(currentPage.title,180)||(url?url:"직접 붙여넣은 원문");if(url){const x=p.chapters.find(c=>cleanUrl(c.url)===url);if(x){x.title=title||x.title;x.processedAt=t;return;}}p.chapters.push({url,title,processedAt:t});if(p.chapters.length>300)p.chapters=p.chapters.slice(-300);}

  function editEntry(e){const input=e.target.closest("input[data-field]");if(!input)return;const p=active(),x=p.entries.find(v=>v.id===input.closest("tr")?.dataset.id);if(!x)return;const field=input.dataset.field,value=clean(input.value,field==="source"?40:60);if(!value){input.value=x[field];status("이름 표기는 비워둘 수 없습니다.",true);return;}if(field==="source"&&p.entries.some(v=>v.id!==x.id&&v.source===value)){input.value=x.source;status("같은 원문 이름이 이미 저장되어 있습니다.",true);return;}x[field]=value;x.updatedAt=now();p.updatedAt=x.updatedAt;save();renderEntries();status("용어집을 수정했습니다.");}
  function deleteEntry(e){const btn=e.target.closest("button[data-action='delete']");if(!btn)return;const p=active(),x=p.entries.find(v=>v.id===btn.closest("tr")?.dataset.id);if(!x||!confirm(`‘${x.source} = ${x.korean}’을 삭제할까요?`))return;p.entries=p.entries.filter(v=>v.id!==x.id);p.updatedAt=now();save();renderEntries();status("인명을 삭제했습니다.");}
  function addManual(e){e.preventDefault();const p=active(),source=clean(el.manualSource.value,40),korean=clean(el.manualKorean.value,60);if(!source||!korean){status("원문 이름과 한국어 표기를 모두 입력해 주세요.",true);return;}if(p.entries.some(x=>x.source===source)){status("같은 원문 이름이 이미 저장되어 있습니다.",true);return;}const t=now();p.entries.push({id:id(),source,korean,createdAt:t,updatedAt:t});p.updatedAt=t;el.manualSource.value="";el.manualKorean.value="";save();renderEntries();status("인명을 직접 추가했습니다.");}

  function glossaryText(){const xs=[...(active()?.entries||[])].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));if(!xs.length)return"";const lines=xs.map(x=>`${x.source} = ${x.korean}`);return el.includeHeader.checked?`[인명 표기표]\n${lines.join("\n")}`:lines.join("\n");}
  async function copyGlossary(){const text=glossaryText();if(!text){status("복사할 인명이 없습니다.",true);return;}try{await navigator.clipboard.writeText(text);}catch{const t=document.createElement("textarea");t.value=text;t.style.position="fixed";t.style.opacity="0";document.body.append(t);t.select();document.execCommand("copy");t.remove();}status("용어집을 클립보드에 복사했습니다.");}
  function downloadTxt(){const text=glossaryText();if(!text){status("저장할 인명이 없습니다.",true);return;}download(`\uFEFF${text}`,`${safeName(active().name)}_인명용어집.txt`,"text/plain;charset=utf-8");status("TXT 파일을 만들었습니다.");}
  function backup(){download(JSON.stringify({app:"novel-person-glossary",version:2,exportedAt:now(),state},null,2),`소설_인명용어집_전체백업_${stamp()}.json`,"application/json;charset=utf-8");status("전체 작품 백업 파일을 만들었습니다.");}
  async function restore(){const file=el.restoreInput.files?.[0];el.restoreInput.value="";if(!file)return;try{const raw=JSON.parse(await file.text()),s=raw?.state||raw;if(!s||!Array.isArray(s.projects))throw new Error("지원하지 않는 백업 파일입니다.");const ps=s.projects.map(normalizeProject).filter(Boolean);if(!ps.length)throw new Error("백업에 유효한 작품이 없습니다.");if(!confirm(`백업의 작품 ${ps.length}개로 현재 데이터를 교체할까요?`))return;state={version:2,activeProjectId:ps.some(p=>p.id===s.activeProjectId)?s.activeProjectId:ps[0].id,projects:ps};save();renderAll();status("백업을 불러왔습니다.");}catch(e){status(e.message||"백업 파일을 읽지 못했습니다.",true);}}

  async function post(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});let data=null;try{data=await r.json();}catch{}if(!r.ok)throw new Error(clean(data?.error||data?.detail,300)||`요청에 실패했습니다. (${r.status})`);return data||{};}
  function status(msg,error=false){el.status.textContent=msg;el.status.classList.toggle("error",error);el.status.hidden=false;}
  function hideStatus(){el.status.hidden=true;el.status.classList.remove("error");}
  function busy(btn,on,label){btn.disabled=on;btn.textContent=label;}
  function countChars(){el.charCount.textContent=`${el.sourceText.value.length.toLocaleString("ko-KR")}자`;}
  function formatDate(v){try{return new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return"";}}
  function safeName(v){return clean(v,80).replace(/[\\/:*?"<>|]+/g,"_").replace(/[. ]+$/g,"")||"용어집";}
  function stamp(){const d=new Date(),p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;}
  function download(content,name,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
})();
