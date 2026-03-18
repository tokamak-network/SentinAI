# SentinAI Docs - Docusaurus Migration Backlog

## Phase 1: 스캐폴딩 및 모노레포 연동
- [x] `SentinAI` 레포지토리 최상단 디렉토리에 `docs-site` 폴더 생성 (`npx create-docusaurus@latest docs-site classic --typescript`).
- [x] 패키지 매니저 워크스페이스(Monorepo) 의존성 충돌 방지 및 `docusaurus.config.ts` 기본 세팅.
- [x] 기존 레포지토리 최상단의 `docs/` 디렉토리(마크다운 원본)를 Docusaurus 내부로 이관.

## Phase 2: 콘텐츠 자동화 및 메타데이터 주입
- [ ] 기존 `website/src/app/docs/[[...slug]]/page.tsx` 내에 하드코딩된 `NAV_ORDER` 배열 제거.
- [ ] 기존 마크다운 파일들(예: `guide/overview.md` 등) 최상단에 Docusaurus Frontmatter(YAML) 일괄 주입 스크립트 작성 및 실행 (`title`, `sidebar_position` 추가).
- [ ] 마크다운 내 기존 정적 자산(이미지/다이어그램) 경로를 Docusaurus의 `static/` 디렉토리 기준으로 일괄 업데이트.

## Phase 3: 랜딩 페이지 및 디자인 일원화
- [ ] 기존 `[[...slug]]/page.tsx`의 3개 진입점 카드(Get Started, Deploy, Reference) 레이아웃을 Docusaurus의 `src/pages/index.tsx`(홈 화면)로 이식.
- [ ] Docusaurus 내장 기능으로 대체되는 기존 웹사이트의 커스텀 컴포넌트(`DocsSidebar.tsx`, `TableOfContents.tsx`, `MarkdownRenderer.tsx`) 정리/삭제.
- [ ] `src/css/custom.css`를 수정하여 테마 컬러 및 다크모드를 기존 SentinAI 사이트 톤앤매너와 동일하게 맞춤.

## Phase 4: 라우팅 마이그레이션 및 Vercel 설정
- [ ] 기존 사용자 북마크 유지: `https://sentinai-xi.vercel.app/docs/guide/overview`와 완벽히 동일한 URL 라우트 구조가 나오도록 문서 위치 및 `sidebars.ts` 구성.
- [ ] Docusaurus 프로젝트를 Vercel에 신규 프로젝트(예: `docs.sentinai.tokamak.network`)로 배포.
- [ ] 기존 Next.js 앱(`website/next.config.ts` 등)에서 `/docs` 하위의 모든 트래픽을 신규 Docusaurus 도메인으로 보내도록 `rewrites`(리버스 프록시) 설정 추가.

## Phase 5: 고급 기능 통합 (MDX & API Docs)
- [ ] `SandboxPanel`, `PurchaseModal` 등의 기존 React 컴포넌트를 MDX 내부에 임베딩하여 인터랙티브한 문서 테스트 환경 구축.
- [ ] `docusaurus-plugin-openapi-docs` 연동하여 마켓플레이스 API 명세서(JSON/YAML) 기반 API 레퍼런스 문서 자동 생성.