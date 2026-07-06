# 🌾 FarmSubsidy Korea (농업보조금 알리미) MCP

한국의 **농업 관련 보조금·지원금 공고를 정부 소스 여러 곳에서 통합(aggregation)** 해서 제공하는 MCP 서버입니다.
카카오 **PlayMCP — AGENTIC PLAYER 10 공모전** 출품작.

- 접수중/접수예정/마감임박 공고를 키워드·지역·상태로 검색
- 접수 마감일·시작일을 **톡캘린더 MCP(CreateEvent)에 바로 넘길 수 있는 일정 데이터**로 변환 → 알림/일정 등록 시나리오
- Streamable HTTP(stateless), MCP 스펙 2025-03-26+ 준수, PlayMCP 심사 요건(annotations 5종, TextContent/Markdown, 24KB 제한, 응답속도) 반영

## 데이터 소스

| 소스 | 방식 | 인증키 | 내용 |
|---|---|---|---|
| 농업e지 (nongupez.go.kr) | REST/JSON | 불필요 | 농식품부 농림사업 통합 포털 — 연도별 전체 사업, 접수기간·온라인신청 여부 (팜모닝의 원본 소스) |
| 보조금24 (행안부 공공서비스 API) | REST/JSON | `GOV24_API_KEY` (data.go.kr, 자동승인) | 중앙부처+지자체 공공서비스(혜택) — 지원대상/내용/신청기한 구조화 데이터 |
| 기업마당 (bizinfo.go.kr) | REST/JSON | `BIZINFO_API_KEY` (즉시발급) | 신청기간이 명확한 지원사업 공고 스트림 |
| 농림축산식품부 공지·공고 RSS | RSS | 불필요 | 부처 공고 원문 실시간 |

수집은 서버 기동 시 1회 + 10분 주기 백그라운드로 수행하고, tool 호출은 항상 메모리 캐시에서 즉시 응답합니다(PlayMCP 응답속도 기준: 평균 100ms, p99 3s). 일부 소스 장애 시 나머지 소스로 계속 서비스합니다.

## 제공 도구 (6종, 전부 읽기 전용)

| Tool | 설명 |
|---|---|
| `search_farm_subsidies` | 키워드/지역/접수상태 통합 검색 (D-day 포함) |
| `get_subsidy_detail` | ID로 상세 조회 (지원대상·내용·신청 링크) |
| `get_closing_soon_subsidies` | N일 이내 마감 임박 공고 (마감일순) |
| `get_upcoming_subsidies` | 접수 예정 공고 (시작일순) |
| `get_daily_briefing` | 신규(3일)/마감임박(7일)/접수예정 데일리 브리핑 |
| `build_calendar_events` | 마감일·시작일 → 톡캘린더 CreateEvent 호환 일정 페이로드 생성 (미리알림 1일/7일 전) |

**톡캘린더 연동 시나리오**: 사용자가 "스마트팜 보조금 마감일 캘린더에 등록해줘"라고 하면, 에이전트가 ① `search_farm_subsidies` → ② `build_calendar_events` → ③ 톡캘린더 MCP의 `CreateEvent`를 순서대로 호출하는 MCP 체이닝으로 완성됩니다.

## API 키 발급 (둘 다 즉시 발급, 무료)

1. **보조금24**: [data.go.kr 15113968](https://www.data.go.kr/data/15113968/openapi.do) → 로그인 → "활용신청" (자동승인) → 마이페이지에서 **일반 인증키(Decoding)** 복사 → `GOV24_API_KEY`
2. **기업마당**: [API 상세 페이지](https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi) 하단 폼에서 정보 입력 후 등록 → 화면/이메일로 인증키 수령 → `BIZINFO_API_KEY`

```
cp .env.example .env   # 키 입력
```

키가 없어도 서버는 뜨고 농식품부 RSS 소스만으로 동작합니다(해당 소스는 접수기간 정보가 제한적).

## 로컬 실행

```bash
npm install
npm run build
npm start        # http://localhost:8080/mcp (POST), /healthz
npm test         # 별도 터미널에서 스모크 테스트 (6개 도구 호출 검증)
```

## 배포 — 카카오클라우드 "PlayMCP in KC"

공모전 예선은 **PlayMCP in KC(컨테이너 배포 서비스) 사용이 필수**입니다. 예선 접수 기간(6/15~7/14)에만 서버 발급 가능, 계정당 2대.

### 방법 A. Git 소스 빌드 (권장 — 가장 간단)
1. 이 프로젝트를 GitHub 저장소에 push (Dockerfile 포함되어 있음)
2. PlayMCP in KC 콘솔에서 Git URL + 브랜치 입력 (private면 PAT 입력)
3. Status가 `Active`가 되면 **Endpoint URL** 발급

### 방법 B. 컨테이너 이미지 등록
```bash
docker build --platform linux/amd64 -t <docker허브ID>/farm-subsidy-mcp:0.1.0 .   # 반드시 linux/amd64
docker push <docker허브ID>/farm-subsidy-mcp:0.1.0
```
콘솔에서 호스트(docker.io)/이미지명/태그 입력.

> 환경변수(`GOV24_API_KEY`, `BIZINFO_API_KEY`)는 배포 콘솔의 환경변수 설정에 입력하세요.

## PlayMCP 등록 절차

1. [playmcp.kakao.com/console](https://playmcp.kakao.com/console) → "새로운 MCP 서버 등록"
2. Endpoint URL 입력 (`https://<발급도메인>/mcp`) → **"정보 불러오기"** 로 tool 목록 fetch 확인
3. MCP 식별자·대화 예시(starter messages)·대표 이미지 입력 → **임시 등록**으로 실제 대화 테스트
4. **"등록 및 심사 요청"** → 승인 후 "나에게만 공개" → **"전체 공개"로 반드시 전환**
5. 공모전 페이지 하단 버튼으로 **예선 참여 접수** (1회만 가능)

### 심사 일정 주의
- 심사는 영업일 최대 7일 (평균 1~2일). **7/7까지 심사 요청하면 7/10까지 심사 완료 보장** — 마감(7/14) 직전 요청은 위험.

### 등록 시 입력 추천값
- **대화 예시**: "이번 주에 마감되는 농업 보조금 알려줘" / "전북 스마트팜 지원사업 찾아줘" / "청년농 보조금 마감일 톡캘린더에 등록해줘" / "오늘의 농업 보조금 브리핑"

## 아키텍처

```
src/
  index.ts        Express + Streamable HTTP (stateless, POST /mcp, GET /healthz)
  server.ts       MCP 도구 6종 정의 (annotations, Markdown 응답, 24KB 캡)
  aggregate.ts    멀티소스 수집·중복제거·정렬 + 백그라운드 갱신(10분) + stale-while-revalidate
  sources/
    nongupez.ts   농업e지 사업검색 API (인증 불필요, JSON POST)
    gov24.ts      보조금24 API (서버측 분야필터 → 실패 시 클라이언트 필터 폴백)
    bizinfo.ts    기업마당 API (농업 키워드 필터)
    mafra.ts      농식품부 RSS (의존성 없는 XML 파싱)
    keywords.ts   농업 판별 키워드/기관 사전
  util.ts         날짜 정규화·기간 파싱·상태 계산·HTML 제거·TTL 캐시
  test/smoke.ts   MCP 클라이언트 스모크 테스트
```
