# 저장소 파일 정리 기준

최종 업데이트: 2026-03-06

이 문서는 저장소 경로를 세 가지로 구분합니다. Git에 계속 추적되어야 하는 경로, 참조/이력 용도로 남겨둘 수 있는 경로, 그리고 재생성 가능한 산출물일 때 정리해야 하는 경로입니다.

## 계속 추적할 것

다음 경로는 프로젝트의 실제 기준 자료이므로 Git에 유지해야 합니다.

- `src/`, `public/`, `scripts/`, `e2e/`: 애플리케이션 코드, 런타임 보조 스크립트, 자동화 테스트입니다.
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`: 빌드와 도구 실행의 진입점입니다.
- `README.md`, `ARCHITECTURE.md`, `ENV_GUIDE.md`, `AGENTS.md`, `RULE.md`: 기여자와 운영자를 위한 핵심 안내 문서입니다.
- `docs/`: 스펙, 가이드, 계획서, 검증 리포트, 아카이브 문맥을 담습니다.
- `website/`: 로드맵과 아키텍처 문서에서 별도 앱으로 관리되는 Next.js 랜딩/연결 앱입니다.
- `examples/`: 문서에서 참조하는 지원 예제 환경입니다.
- `rules/`: 프로젝트 워크플로우에서 사용하는 재사용 가능한 로컬 운영 규칙입니다.

## 참조/이력으로 유지 가능

다음 경로는 핵심 런타임 코드는 아니지만 의도적으로 남긴 기록이므로 무작정 삭제하면 안 됩니다.

- `benchmark-results/`: 벤치마크 스크립트와 가이드에서 참조하는 결과물입니다.
- `data/reports/`: 리포트 생성기와 스펙에서 참조하는 일일 보고서 출력물입니다.
- `docs/archive/`: 아카이브된 계획서와 과거 문맥입니다.
- `docs/verification/`: 검증 근거와 리포트 템플릿입니다.
- `memory/`: 프로젝트 이력으로 보관하는 proposal 상태 스냅샷입니다.

## 삭제하거나 무시할 것

다음 경로는 재생성 가능하거나 머신 종속적이므로 추적 상태로 남겨두지 않아야 합니다.

- `.DS_Store`: 프로젝트 가치가 없는 macOS Finder 메타데이터입니다.
- `e2e-artifacts/`, `test-results/`, `playwright-report/`: 테스트 실행 중 생성되는 스크린샷과 런타임 결과물입니다.
- `.next/`, `website/.next/`, `website/out/`: Next.js 빌드 산출물입니다.
- `coverage/`, `.lighthouseci/`: 생성형 분석 결과물입니다.
- `tmp/`, `test-artifacts/`: 로컬 임시 파일입니다.

## 이번 정리에서 적용한 조치

- 추적 중이던 `.DS_Store`를 제거했습니다.
- 추적 중이던 `e2e-artifacts/connect-success.png`를 제거했습니다.
- `.gitignore`에 `.DS_Store`, `tmp/`, `test-artifacts/`를 추가했습니다.
- 로컬 생성 산출물 `.next/`, `website/.next/`, `website/out/`, `.lighthouseci/`, `coverage/`, `e2e-artifacts/`, `test-results/`, `tmp/`를 정리했습니다.
- `docs/README.md`에서 참조하는 활성 교훈 인덱스로 `docs/lessons.md`를 만들었습니다.

## 안전한 정리 명령

로컬 산출물이 더 이상 필요 없을 때만 아래 명령을 실행합니다.

```bash
rm -rf .next .lighthouseci coverage e2e-artifacts test-results tmp website/.next website/out
```

활성 개발 중에는 의도적으로 콜드 리빌드를 하려는 경우가 아니라면 `node_modules/`나 `.next/`를 삭제하지 않는 편이 좋습니다.
