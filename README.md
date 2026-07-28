# 중국소설 용어집 추출기 V2

## 가장 간단한 사용 순서

1. 이 저장소 파일을 GitHub에 올립니다.
2. Cloudflare에서 Workers & Pages → Create → Pages → GitHub 연결을 선택합니다.
3. 이 저장소를 선택합니다.
4. Framework preset은 None, Build command는 비움, Output directory는 `/`로 설정합니다.
5. 배포 후 Settings → Variables and Secrets에서 `GEMINI_API_KEY`를 Secret으로 추가합니다.
6. 다시 배포합니다.
7. 만들어진 `pages.dev` 주소를 아이폰 홈 화면에 추가합니다.

## 기능

- URL 또는 본문 붙여넣기
- 인물 / 지명·세력 / 기타 용어 분류
- 한국 한자음 표기
- 기존 작품 용어집 자동 병합
- 콜로모용 용어집 복사
- 번역 지침과 함께 복사
- 작품별 저장
- TXT 다운로드

## 파일 구조

- `index.html`
- `style.css`
- `app.js`
- `functions/api/extract.js`
- `wrangler.toml`

## 중요한 점

`GEMINI_API_KEY`는 코드 파일에 직접 쓰지 말고 반드시 Cloudflare Secret으로 등록하세요.
