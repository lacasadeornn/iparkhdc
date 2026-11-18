# ConRisk: 건설 현장 리스크 관리 서비스

리스크 대장을 적어 두는 데서 끝나지 않고, 현장소장·본사가 **이번 주에 어떤 리스크에 돈과 사람을 붙일지**와 **공기·원가 예비비를 얼마나 잡을지** 정할 수 있게 돕는 웹 서비스입니다.

- 주소: https://conrisk.pages.dev (Google 계정으로 로그인해야 열립니다)
- 구성: Cloudflare Pages(정적 화면) + Pages Functions(로그인·저장 API) + Cloudflare KV(공유 저장소)
- 외부 CDN·외부 글꼴을 쓰지 않습니다. 외부와 연결되는 것은 Google 로그인 화면뿐입니다.

## 기능

| 화면 | 내용 |
|---|---|
| 대시보드 | 진행 중·잔존 높음·기한 경과·대응전략 미정 건수, 원가 기대값 합계. KPI 카드마다 어떻게 셌는지 함께 표시합니다. |
| 이번 주 결정할 리스크 3건 | 종결 아닌 리스크를 발현 여부 → 잔존 점수 → 기한 경과 → 대응전략 미정 → 원가 기대값 순으로 정렬해 상위 3건을 이유와 함께 보여 줍니다. |
| 리스크 매트릭스 | 5×5 확률·영향 매트릭스. 대응 전(고유)과 대응 후(잔존)를 전환해 볼 수 있습니다. |
| 리스크 대장 | 등록·수정·삭제, 검색·필터·정렬, CSV 내보내기(엑셀 수식 주입 방지 처리). |
| 예비비 산정 | 몬테카를로 시뮬레이션으로 원가·공기 영향의 P50/P80/P90을 계산하고, 분포와 리스크별 기여도를 보여 줍니다. |

### 점수와 계산 기준
- **점수** = 확률 등급(1~5) × 영향 등급(1~5). 15 이상 높음, 8~14 중간, 7 이하 낮음.
- **잔존 확률 등급**은 입력한 발생확률(%)에서 환산합니다: 10% 미만=1, 30% 미만=2, 50% 미만=3, 70% 미만=4, 그 이상=5.
- **원가 기대값** = 발생확률 × 삼각분포 평균((최소+최빈+최대)/3). 단위는 백만원입니다.
- **예비비 시뮬레이션**은 종결된 리스크와 확률 0%인 리스크를 빼고 계산합니다. 반복마다 리스크별로 발생 여부를 뽑고, 발생하면 3점 추정 삼각분포에서 원가·공기 영향을 뽑아 더합니다. AACE 권장실무 41R-08·57R-09의 확률적 예비비 방식을 단순화한 것입니다.
  - 가정 1: 리스크끼리 서로 영향을 주지 않는다(독립).
  - 가정 2: 공기 영향은 모두 주공정에 더해진다. 실제보다 크게 나오는 쪽(보수적)입니다.
  - 난수 시드를 고정했기 때문에 입력이 같으면 결과도 같습니다.
- 처음 열면 **가상의 공동주택 현장 예시 리스크 10건**이 들어 있습니다. 실제 현장 데이터가 아니므로 지우거나 고쳐서 쓰면 됩니다.

## 폴더 구조

```
public/            화면 (index.html, app.js, sim.js 계산 모듈, seed.js 예시 데이터, login.html)
functions/         Cloudflare Pages Functions
  _middleware.js   모든 요청 앞에서 로그인 확인 (미로그인: 화면은 /login으로, API는 401)
  auth/login.js    Google 로그인 화면으로 보냄
  auth/callback.js Google ID 토큰 검증 → 세션 쿠키 발급
  auth/logout.js   로그아웃
  api/me.js        로그인 사용자 정보
  api/register.js  리스크 대장 읽기/저장 (KV, 버전 충돌 방지)
lib/               인증·HTTP 공용 코드
test/              단위 테스트 (node --test)
scripts/check-gate.mjs  배포된 주소가 로그인 없이 막히는지 검사
```

## 로컬 실행

필요한 것: Node 20 이상.

```bash
npm install
```

```bash
copy .dev.vars.example .dev.vars
```

`.dev.vars`에 `DEV_AUTH_BYPASS=1`을 두면 localhost로 접속할 때만 로그인 없이 화면을 볼 수 있습니다. `SESSION_SECRET`에는 32자 이상의 임의 문자열을 넣으세요.

```bash
npm run dev
```

브라우저에서 http://localhost:8788 을 엽니다. 로컬 KV는 `.wrangler/` 폴더에 저장됩니다.

> PowerShell에서 `npm`/`npx` 실행이 "스크립트를 실행할 수 없으므로" 오류로 막히면 `npm.cmd run dev`처럼 `.cmd`를 붙여 실행하세요.

## 테스트

```bash
npm test
```

현재 18개 테스트가 있습니다.
- 계산: 시뮬레이션 평균이 해석적 기대값과 1% 안에서 맞는지(50,000회), 삼각분포 경계, 1만 회 계산이 1초 안에 끝나는지, 등급 환산, 결정 필요 리스크의 정렬 순서.
- 인증: 실제 RSA 키로 서명한 토큰으로 검사합니다. 위조 서명, 다른 앱용 토큰(aud), 발급자 위조, 만료, nonce 불일치, 이메일 미인증, HS256 등 다른 알고리즘 토큰, 허용 목록, 세션 쿠키 변조를 각각 거절하는지 확인합니다.

배포 후에는 아래 명령으로 로그인 없이 접근할 때 막히는지 검사합니다.

```bash
npm run check:gate
```

## 배포: Cloudflare Pages(GitHub 연결)

1. Cloudflare 대시보드에서 **Workers & Pages → 만들기 → Pages → Git에 연결**을 선택합니다.
2. GitHub 저장소 `skala202501/iparkhdc1`을 고르고 프로젝트 이름을 **`conrisk`**로 정합니다. 이 이름으로 주소가 `conrisk.pages.dev`가 됩니다.
3. 빌드 설정
   - 프레임워크: 없음
   - 빌드 명령: 비워 둠
   - 빌드 출력 디렉터리: `public`
   - 루트 디렉터리: `/`
4. **설정 → 변수 및 비밀**에 아래 값을 넣습니다(프로덕션).

| 이름 | 종류 | 값 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | 텍스트 | Google OAuth 클라이언트 ID (`…apps.googleusercontent.com`) |
| `SESSION_SECRET` | **비밀(암호화)** | 32자 이상 임의 문자열 |
| `ALLOWED_EMAILS` | 텍스트(선택) | 허용할 이메일. 쉼표로 구분 |
| `ALLOWED_DOMAINS` | 텍스트(선택) | 허용할 도메인. 예: `hdc-dvp.com` |

   `ALLOWED_EMAILS`와 `ALLOWED_DOMAINS`를 **둘 다 비우면 이메일 인증된 모든 Google 계정이 들어올 수 있습니다.** 사내용이라면 반드시 하나는 넣으세요.

5. **KV 연결(팀 공유 저장)**: Workers & Pages → KV에서 네임스페이스(예: `conrisk-register`)를 만들고, Pages 프로젝트의 **설정 → 바인딩 → KV 네임스페이스**에 변수 이름 **`CONRISK_KV`**로 연결합니다. 연결하지 않으면 화면 위에 경고가 뜨고, 각자 브라우저에만 저장됩니다.
6. 변수나 바인딩을 바꾼 뒤에는 **배포 → 재배포**를 해야 반영됩니다.

이후에는 `main` 브랜치에 푸시할 때마다 자동으로 배포됩니다.

## Google 로그인 설정 (Google Cloud Console)

이 서비스는 OpenID Connect의 `id_token` + `form_post` 방식을 씁니다. 그래서 **클라이언트 비밀값(client secret)이 필요 없고, 저장소에도 넣지 않습니다.** 서버는 Google 공개키로 토큰 서명을 검증하고, 발급자·대상(aud)·만료·nonce·이메일 인증 여부를 확인합니다.

1. https://console.cloud.google.com → 프로젝트 선택 또는 생성
2. **API 및 서비스 → OAuth 동의 화면**: 사용자 유형을 고릅니다. Google Workspace 조직 계정만 쓸 경우 "내부", 아니면 "외부"를 고르고, 외부라면 게시 상태를 확인합니다. 범위는 `openid`, `email`, `profile`만 있으면 됩니다.
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI:
     - `https://conrisk.pages.dev/auth/callback`
     - (로컬 시험용, 선택) `http://localhost:8788/auth/callback`
4. 만들어진 **클라이언트 ID**만 Cloudflare 변수 `GOOGLE_CLIENT_ID`에 넣습니다. 클라이언트 보안 비밀번호는 쓰지 않습니다.

## 보안 메모
- 세션 쿠키 `cr_session`: HttpOnly·Secure·SameSite=Lax, HMAC-SHA256 서명, 8시간 유효
- 모든 화면·스크립트·API가 로그인 뒤에 있습니다. 공개 경로는 `/login`, `/login.js`, `/style.css`, `/favicon.svg`, `/auth/*`뿐입니다.
- 보안 헤더: CSP(`script-src 'self'`, 인라인 스크립트 금지), X-Frame-Options DENY, nosniff
- 동시 수정: 저장할 때 버전을 비교해, 다른 사람이 먼저 저장했으면 409로 거절하고 최신본을 다시 불러옵니다.
- `DEV_AUTH_BYPASS`는 localhost 접속일 때만 동작합니다. 그래도 Cloudflare 변수에는 넣지 마세요.

## 다른 로그인 방식: Cloudflare Access
코드 없이 Cloudflare Zero Trust의 Access 애플리케이션으로 `conrisk.pages.dev` 앞에 Google 로그인을 붙이는 방법도 있습니다. 이 경우 Google 클라이언트 비밀값은 Cloudflare Zero Trust 대시보드에 입력합니다. Zero Trust 가입(팀 이름 설정, 무료 플랜이라도 결제수단 등록을 요구할 수 있음)이 필요합니다. 이 방식으로 바꾸면 `functions/_middleware.js`의 세션 검사 대신 `Cf-Access-Jwt-Assertion` 헤더를 검증하도록 고치면 됩니다.

## 한계
- 리스크 간 상관관계(예: 동절기 + 레미콘 수급)는 반영하지 않습니다.
- 공정표(CPM)와 연결되지 않아, 공기 영향을 모두 주공정에 더합니다.
- 변경 이력은 리스크별 마지막 수정자·시각만 남깁니다(전체 감사 로그 없음).
- KV는 한 문서(리스크 수백 건 규모)를 통째로 저장합니다. 1MB를 넘으면 저장이 거절됩니다.
