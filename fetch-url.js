const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 180000;
const MAX_REDIRECTS = 4;

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    const requested = validateUrl(body.url);
    const response = await followRedirects(requested);
    if (!response.ok) return error(`대상 사이트가 ${response.status} 오류를 반환했습니다.`, 502);

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
      return error("HTML 또는 텍스트 페이지 URL만 불러올 수 있습니다.", 415);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return error("페이지가 너무 커서 불러올 수 없습니다.", 413);

    const bytes = await readLimited(response.body, MAX_BYTES);
    const html = decodePage(bytes, contentType);
    const result = extractPage(html);
    if (result.text.length < 80) {
      return error("본문을 충분히 찾지 못했습니다. 사이트가 자동 접근을 막는 경우 원문을 직접 붙여넣어 주세요.", 422);
    }
    return json({ text: result.text.slice(0, MAX_TEXT), title: result.title, bookTitle: result.bookTitle, finalUrl: response.url || requested.toString() });
  } catch (e) {
    return error(clean(e?.message, 500) || "URL을 불러오지 못했습니다.", Number(e?.status) || 500);
  }
}

export async function onRequest() { return error("POST 요청만 지원합니다.", 405); }

async function followRedirects(initial) {
  let url = initial;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(url.toString(), {
      method: "GET", redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NovelGlossary/2.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "Accept-Language": "zh-CN,zh;q=0.9,ko;q=0.7,en;q=0.5"
      }
    });
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw httpError("리디렉션 주소가 비어 있습니다.", 502);
    url = validateUrl(new URL(location, url).toString());
  }
  throw httpError("리디렉션이 너무 많습니다.", 508);
}

function validateUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw httpError("올바른 URL을 입력해 주세요.", 400); }
  if (!["http:","https:"].includes(url.protocol)) throw httpError("http 또는 https URL만 지원합니다.", 400);
  if (url.username || url.password) throw httpError("로그인 정보가 포함된 URL은 지원하지 않습니다.", 400);
  if (!url.hostname || blockedHost(url.hostname)) throw httpError("보안상 해당 주소는 불러올 수 없습니다.", 400);
  url.hash = ""; return url;
}

function blockedHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const p = host.split(".").map(Number); if (!p.every(x => x >= 0 && x <= 255)) return true;
  const [a,b] = p;
  return a===0 || a===10 || a===127 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || a>=224;
}

async function readLimited(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = []; let total = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { try { await reader.cancel(); } catch {} throw httpError("페이지가 너무 커서 불러올 수 없습니다.", 413); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

function decodePage(bytes, contentType) {
  const preview = Array.from(bytes.slice(0,4096), b => b < 128 ? String.fromCharCode(b) : " ").join("");
  const header = /charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i.exec(contentType)?.[1];
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i.exec(preview)?.[1] || /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9._-]+)/i.exec(preview)?.[1];
  let charset = String(header || meta || "utf-8").toLowerCase();
  if (["gbk","gb2312","gb_2312-80","x-gbk"].includes(charset)) charset = "gb18030";
  if (["utf8","utf_8"].includes(charset)) charset = "utf-8";
  if (["shift-jis","sjis","x-sjis"].includes(charset)) charset = "shift_jis";
  try { return new TextDecoder(charset, {fatal:false}).decode(bytes); } catch { return new TextDecoder("utf-8", {fatal:false}).decode(bytes); }
}

function extractPage(html) {
  const title = extractTitle(html), bookTitle = extractBookTitle(html, title), candidates = [];
  const articleBody = extractJsonLd(html, "articleBody"); if (typeof articleBody === "string") candidates.push(articleBody);
  let match;
  const tagged = /<(article|main|section|div)\b([^>]*(?:id|class)\s*=\s*["'][^"']*(?:chapter|content|article|read|novel|text|正文|阅读)[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((match = tagged.exec(html)) && candidates.length < 80) candidates.push(match[3]);
  const broad = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((match = broad.exec(html)) && candidates.length < 100) candidates.push(match[2]);
  candidates.push(/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html);

  let best = "", score = -Infinity;
  for (const candidate of candidates) {
    const text = cleanText(htmlToText(candidate)); if (text.length < 80) continue;
    const s = scoreText(text); if (s > score) { score = s; best = text; }
  }
  return { title, bookTitle, text: best.slice(0, MAX_TEXT) };
}

function scoreText(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g)||[]).length, lines = text.split("\n").filter(Boolean).length;
  const penalty = (text.match(/上一章|下一章|目录|返回书页|加入书签|最新网址|手机阅读/g)||[]).length;
  return Math.min(text.length,220000) + Math.min(lines,400)*40 + (cjk/Math.max(text.length,1))*20000 - penalty*450;
}

function htmlToText(fragment) {
  return decodeEntities(String(fragment)
    .replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<(script|style|noscript|svg|canvas|template|form|button|select|option)\b[\s\S]*?<\/\1>/gi," ")
    .replace(/<(header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi," ")
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|blockquote|tr)>/gi,"\n")
    .replace(/<[^>]+>/g," "));
}

function cleanText(text) {
  const lines = String(text).replace(/\r/g,"").replace(/[\t\f\v\u00a0\u3000]+/g," ").split("\n").map(x=>x.replace(/ {2,}/g," ").trim()).filter(Boolean);
  const seen = new Map(), out = [];
  for (const line of lines) {
    if (boilerplate(line)) continue;
    const n = seen.get(line)||0; if (n>=2) continue; seen.set(line,n+1); out.push(line);
  }
  return out.join("\n").trim();
}

function boilerplate(line) {
  if (line.length > 80) return false;
  return /^(?:上一章|下一章|上一页|下一页|返回目录|章节目录|目录|首页|书页|登录|注册|收藏|投票|推荐|下载|阅读设置|字体|繁体|简体)\s*$/i.test(line)
    || /请记住本站|最新网址|手机用户请浏览|本章未完|点击下一页|加入书签|无弹窗|广告合作|免责声明/i.test(line);
}

function extractTitle(html) {
  const value = meta(html,"property","og:title") || meta(html,"name","og:title") || /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "";
  return clean(htmlToText(value),180);
}

function extractBookTitle(html, pageTitle) {
  const direct = meta(html,"property","og:novel:book_name") || meta(html,"name","book_name") || meta(html,"property","books:book_name") || meta(html,"name","novel-name") || extractJsonLdBook(html);
  if (direct) return cleanBook(direct);
  const parts = clean(pageTitle,180).split(/\s*[-_|·]\s*/).map(cleanBook).filter(Boolean).filter(x=>!/第.{0,12}[章节回卷]|全文阅读|最新章节|无弹窗|小说网|书库/.test(x));
  return parts.length >= 2 ? parts[parts.length-2] : "";
}

function cleanBook(v) { return clean(htmlToText(v),80).replace(/^[《〈「『【]\s*/,"").replace(/\s*[》〉」』】]$/,""); }
function meta(html, attr, value) {
  const e = String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const ps = [new RegExp(`<meta\\b[^>]*${attr}\\s*=\\s*["']${e}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,"i"),new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*${attr}\\s*=\\s*["']${e}["'][^>]*>`,"i")];
  for (const p of ps) { const x=p.exec(html)?.[1]; if(x) return decodeEntities(x); } return "";
}

function ldScripts(html) { return html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[]; }
function extractJsonLd(html,key) { for(const s of ldScripts(html).slice(0,20)){try{const data=JSON.parse(s.replace(/^<script\b[^>]*>/i,"").replace(/<\/script>$/i,"").trim()),v=findProp(data,key);if(v!==undefined)return v;}catch{}} return ""; }
function extractJsonLdBook(html) { for(const s of ldScripts(html).slice(0,20)){try{const data=JSON.parse(s.replace(/^<script\b[^>]*>/i,"").replace(/<\/script>$/i,"").trim()),nodes=Array.isArray(data)?data:[data];for(const n of nodes){if(n?.isPartOf?.name)return String(n.isPartOf.name);if(["Book","Novel"].includes(n?.["@type"])&&n?.name)return String(n.name);}}catch{}}return""; }
function findProp(v,key){if(!v||typeof v!=="object")return undefined;if(Object.prototype.hasOwnProperty.call(v,key))return v[key];for(const x of Object.values(v)){const found=findProp(x,key);if(found!==undefined)return found;}return undefined;}

function decodeEntities(v) {
  const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",hellip:"…",middot:"·",mdash:"—",ndash:"–",laquo:"«",raquo:"»",copy:"©"};
  return String(v).replace(/&#(\d+);/g,(_,c)=>cp(Number(c))).replace(/&#x([0-9a-f]+);/gi,(_,c)=>cp(parseInt(c,16))).replace(/&([a-z]+);/gi,(all,n)=>named[n.toLowerCase()]??all);
}
function cp(n){try{return n>0&&n<=0x10ffff?String.fromCodePoint(n):"";}catch{return"";}}
async function readJson(request){if(!(request.headers.get("content-type")||"").toLowerCase().includes("application/json"))throw httpError("JSON 요청만 지원합니다.",415);return request.json();}
function clean(v,max=200){return String(v??"").replace(/[\u0000-\u001F\u007F]+/g," ").replace(/\s+/g," ").trim().slice(0,max);}
function httpError(message,status){const e=new Error(message);e.status=status;return e;}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function error(message,status){return json({error:message},status);}
