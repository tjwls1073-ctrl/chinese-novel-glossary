const MAX_HTML = 2_000_000;
const MAX_TEXT = 80_000;

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const model = cleanModel(
      body.model ||
      env.GEMINI_MODEL ||
      "gemini-2.5-flash"
    );

    // 화면에서 입력한 API 키를 우선 사용하고,
    // 입력하지 않았다면 Cloudflare Secret을 사용한다.
    const apiKey = String(
      body.apiKey ||
      env.GEMINI_API_KEY ||
      ""
    ).trim();

    if (!apiKey) {
      return jsonResponse(
        {
          error:
            "Gemini API 키가 없습니다. 화면에 API 키를 입력하거나 Cloudflare Secret에 GEMINI_API_KEY를 등록해 주세요."
        },
        401
      );
    }

    let text = "";
    let pageTitle = "";

    if (body.mode === "text") {
      text = String(body.text || "");
    } else {
      const url = validateUrl(body.url);
      const html = await fetchPage(url);

      pageTitle = extractTitle(html);
      text = extractHtmlText(html);
    }

    text = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT);

    if (text.length < 50) {
      return jsonResponse(
        {
          error:
            "본문을 충분히 가져오지 못했습니다. URL 대신 ‘본문 붙여넣기’를 사용해 주세요."
        },
        422
      );
    }

    const existing = Array.isArray(body.existing)
      ? body.existing.slice(0, 1000)
      : [];

    const prompt = makePrompt(text, existing);

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",

            responseSchema: {
              type: "OBJECT",

              properties: {
                entries: {
                  type: "ARRAY",

                  items: {
                    type: "OBJECT",

                    properties: {
                      src: {
                        type: "STRING"
                      },

                      ko: {
                        type: "STRING"
                      },

                      cat: {
                        type: "STRING",
                        enum: ["person", "place", "term"]
                      }
                    },

                    required: ["src", "ko", "cat"]
                  }
                }
              },

              required: ["entries"]
            }
          }
        })
      }
    );

    const geminiData = await geminiResponse
      .json()
      .catch(() => ({}));

    if (!geminiResponse.ok) {
      return jsonResponse(
        {
          error:
            geminiData?.error?.message ||
            `Gemini API 오류가 발생했습니다. (${geminiResponse.status})`
        },
        502
      );
    }

    const candidate = geminiData?.candidates?.[0];

    const output = candidate?.content?.parts
      ?.map(part => part?.text || "")
      .join("")
      .trim();

    if (!output) {
      const finishReason =
        candidate?.finishReason ||
        geminiData?.promptFeedback?.blockReason ||
        "";

      return jsonResponse(
        {
          error: finishReason
            ? `Gemini 응답이 비어 있습니다. 사유: ${finishReason}`
            : "Gemini 응답이 비어 있습니다."
        },
        502
      );
    }

    let parsed;

    try {
      const cleanedOutput = output
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      parsed = JSON.parse(cleanedOutput);
    } catch (error) {
      return jsonResponse(
        {
          error:
            "Gemini가 보낸 결과를 JSON으로 해석하지 못했습니다.",
          detail: output.slice(0, 1500)
        },
        502
      );
    }

    let extractedEntries = [];

    if (Array.isArray(parsed)) {
      extractedEntries = parsed;
    } else if (Array.isArray(parsed?.entries)) {
      extractedEntries = parsed.entries;
    } else {
      return jsonResponse(
        {
          error:
            "Gemini 응답에 entries 배열이 없습니다.",
          detail: output.slice(0, 1500)
        },
        502
      );
    }

    extractedEntries = extractedEntries
      .map(item => {
        const src = String(item?.src || "").trim();
        const ko = String(item?.ko || "").trim();

        let cat = String(item?.cat || "").trim();

        if (!["person", "place", "term"].includes(cat)) {
          cat = "term";
        }

        return {
          src,
          ko,
          cat
        };
      })
      .filter(item => {
        if (!item.src || !item.ko) return false;

        // 중국어 원문 항목만 남긴다.
        if (!/[\u3400-\u9fff]/.test(item.src)) return false;

        // 지나치게 긴 문장이나 잘못된 결과를 제거한다.
        if (item.src.length > 60) return false;
        if (item.ko.length > 60) return false;

        return true;
      });

    const mergedMap = new Map();

    // 기존 용어집을 먼저 넣는다.
    for (const item of existing) {
      const src = String(item?.src || "").trim();
      const ko = String(item?.ko || "").trim();

      if (!src || !ko) continue;

      mergedMap.set(src, {
        src,
        ko,
        cat: ["person", "place", "term"].includes(item?.cat)
          ? item.cat
          : "term"
      });
    }

    // 새로 추출한 결과가 기존 결과를 덮어쓴다.
    // 잘못된 기존 번역을 Gemini가 교정할 수 있게 하기 위함이다.
    for (const item of extractedEntries) {
      mergedMap.set(item.src, item);
    }

    return jsonResponse({
      entries: [...mergedMap.values()],
      pageTitle,
      model
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error?.name === "AbortError"
            ? "웹페이지를 불러오는 시간이 너무 오래 걸렸습니다."
            : error?.message || "서버 오류가 발생했습니다."
      },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,

    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanModel(value) {
  const model = String(value || "").trim();

  if (!/^[\w.-]{3,80}$/.test(model)) {
    throw new Error("Gemini 모델 이름이 올바르지 않습니다.");
  }

  return model;
}

function validateUrl(rawUrl) {
  let url;

  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("올바른 URL을 입력해 주세요.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("http 또는 https 주소만 사용할 수 있습니다.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("내부 네트워크 주소는 사용할 수 없습니다.");
  }

  url.username = "";
  url.password = "";

  return url;
}

function isPrivateIp(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const [a, b] = hostname
      .split(".")
      .map(Number);

    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80")
  );
}

async function fetchPage(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,

      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",

        Accept:
          "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(
        `웹페이지를 불러오지 못했습니다. (${response.status})`
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !/text\/html|application\/xhtml\+xml/i.test(
        contentType
      )
    ) {
      throw new Error("HTML 형식의 웹페이지가 아닙니다.");
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_HTML) {
      throw new Error("웹페이지의 크기가 너무 큽니다.");
    }

    const charset =
      /charset=([^;]+)/i.exec(contentType)?.[1]?.trim() ||
      detectCharset(arrayBuffer) ||
      "utf-8";

    try {
      return new TextDecoder(charset).decode(arrayBuffer);
    } catch {
      return new TextDecoder("utf-8").decode(arrayBuffer);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function detectCharset(arrayBuffer) {
  try {
    const preview = new TextDecoder("ascii")
      .decode(arrayBuffer.slice(0, 5000));

    return (
      /<meta[^>]+charset=["']?\s*([^"' />]+)/i.exec(
        preview
      )?.[1] ||
      /<meta[^>]+content=["'][^"']*charset=([^"' ;>]+)/i.exec(
        preview
      )?.[1] ||
      ""
    );
  } catch {
    return "";
  }
}

function extractTitle(html) {
  const match = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return decodeEntities(
    String(match?.[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 120);
}

function extractHtmlText(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|canvas|iframe|form|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|article|section|li|h[1-6]|blockquote)>/gi,
      "\n"
    )
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(cleaned)
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text) {
  const namedEntities = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'"
  };

  return String(text || "")
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39);/gi,
      match =>
        namedEntities[match.toLowerCase()] || match
    )
    .replace(
      /&#(\d+);/g,
      (_, number) =>
        String.fromCodePoint(Number(number))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, number) =>
        String.fromCodePoint(
          parseInt(number, 16)
        )
    );
}

function makePrompt(text, existing) {
  return `중국어 웹소설 본문에서 번역에 필요한 고유명사를 최대한 빠짐없이 추출하라.

반드시 다음 JSON 형식만 출력한다.

{"entries":[{"src":"원문 표기","ko":"한국어 표기","cat":"person"}]}

설명, 코드블록, 주석, 머리말, 맺음말은 절대 출력하지 않는다.

cat은 다음 세 값 중 하나만 사용한다.

- person: 인명, 성명, 자, 호, 별명, 코드명
- place: 지명, 국가, 도시, 지역, 산천, 가문, 문파, 종문, 조직, 세력
- term: 직책, 관직, 공법, 무공, 술법, 무기, 법보, 영물, 괴담, 던전, 시스템 고유명

[추출 기준]

1. 본문에 실제로 등장한 고유명사를 추출한다.

2. 한 글자 이름, 두 글자 이름, 세 글자 이상의 이름도 누락하지 않는다.

3. 성과 이름이 함께 등장하면 전체 이름을 우선 추출한다.

4. 성만 등장하거나 이름 일부만 반복되더라도, 문맥상 동일 인물의 정식 이름을 알 수 있으면 정식 이름을 사용한다.

5. 동일 항목은 한 번만 출력한다.

6. 일반 명사, 대명사, 단순 호칭, 웹사이트 메뉴, 광고 문구는 제외한다.

7. 이름인지 확실하지 않은 일반 단어를 억지로 포함하지 않는다.

[표기 판단 절차]

각 고유명사마다 한자 모양만 보고 결정하지 말고 작품 배경과 주변 문맥을 확인하여 다음 중 무엇인지 판단한다.

A. 실제 중국식 고유명사  
B. 중국어로 음차된 외국·서양·판타지 고유명사  
C. 일본식 고유명사  
D. 의미를 가진 별명·코드명  
E. 기술·직책·아이템·조직 등의 명칭

[실제 중국식 고유명사]

실제 중국식 인명·지명·가문·문파·조직은 표준적인 한국 한자음으로 옮긴다.

중국어 병음이나 중국식 발음을 한글로 음역하지 않는다.

예시:

张三 → 장삼  
李青 → 이청  
夏常笑 → 하상소  
除炫 → 제현  
加三 → 가삼  

다음과 같이 옮기지 않는다.

张三 → 장싼  
李青 → 리칭  
夏常笑 → 샤창샤오  
除炫 → 추현  
加三 → 가산  

각 한자의 실제 한국 한자음을 확인하여 표기한다. 중국어 발음과 비슷하다는 이유로 임의의 음을 선택하지 않는다.

[외국·서양·판타지 고유명사]

중국어 한자로 음차된 외국·서양·판타지 이름은 한국 한자음으로 읽지 않는다.

가능한 경우 원래 이름과 발음을 복원하여 자연스러운 한국어 외래어 표기로 옮긴다.

예시:

丹尼尔 → 다니엘  
威尔逊 → 윌슨  
亨利 → 헨리  
克里斯 → 크리스  
亚历山大 → 알렉산더  
凯文 → 케빈  
杰克 → 잭  
乔治 → 조지  
露西 → 루시  
艾伦 → 앨런  

다음과 같은 기계적 한자음 표기는 금지한다.

丹尼尔 → 단니이  
威尔逊 → 위이손  
亨利 → 형리  
克里斯 → 극리사  
亚历山大 → 아력산대  

원래 이름을 정확히 특정하기 어려운 판타지 이름은 중국어 발음과 문맥을 참고하여 한국 독자가 자연스럽게 읽을 수 있는 표기로 옮긴다.

예시:

克孜斯奈尔 → 크즈스나엘

다음과 같이 옮기지 않는다.

克孜斯奈尔 → 극자사내이

외국 이름 표기 규칙을 실제 중국식 이름에 적용하지 않는다.

[일본식 고유명사]

일본인이나 일본 지명으로 판단되면 한국 한자음이 아니라 일본식 독음을 사용한다.

중국식인지 일본식인지 불분명하면 작품 배경과 주변 문맥을 우선 확인한다.

[별명과 코드명]

뜻이 명확하고 그 의미가 중요한 별명이나 코드명은 자연스러운 한국어 뜻으로 번역한다.

예시:

嫩芽 → 새싹  
海鸥 → 갈매기  

다만 작품 안에서 인명처럼 고정적으로 사용되는 표기라면 문맥에 맞춰 한자음 표기를 사용할 수 있다.

[기술·직책·아이템·조직명]

기술, 직책, 공법, 무기, 아이템, 던전, 시스템 명칭은 무조건 한자음으로만 읽지 않는다.

뜻이 중요한 명칭은 자연스러운 한국어로 번역하되 고유명으로서의 성격을 유지한다.

[기존 용어집]

기존 용어집은 작품 내 표기 일관성을 위한 참고 자료다.

기존 표기가 자연스럽고 올바르면 유지한다.

기존 표기가 명백한 병음식 음역이나 기계적인 한자음 변환이면 그대로 따르지 말고 올바르게 고친다.

잘못된 표기와 올바른 표기의 예:

夏常笑 = 샤창샤오 → 夏常笑 = 하상소  
除炫 = 추현 → 除炫 = 제현  
加三 = 가산 → 加三 = 가삼  
丹尼尔 = 단니이 → 丹尼尔 = 다니엘  
威尔逊 = 위이손 → 威尔逊 = 윌슨  
克里斯 = 극리사 → 克里斯 = 크리스  
克孜斯奈尔 = 극자사내이 → 克孜斯奈尔 = 크즈스나엘  

기존 용어집:
${JSON.stringify(existing)}

본문:
${text}`;
}
