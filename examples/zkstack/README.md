# ZK Stack Integration Template for SentinAI

이 폴더는 `external/` 레포를 직접 의존하지 않고 ZK Stack 연동을 재현하기 위한 표준 예제 템플릿입니다.

## Files

- `.env.example`: SentinAI + ZK Stack 연동 기본 환경 변수 템플릿
- `docker-compose.core-only.yml`: 핵심 런타임(`zkstack-core`, `zkstack-apis`)만 띄우는 server-v2 템플릿
- `secrets.container.yaml.example`: 컨테이너에서 host의 L1/Postgres에 연결하기 위한 secrets 예시
- `settlement-probe-response.example.json`: `ZK_BATCHER_STATUS_URL` probe 응답 스키마 예제

## Quick Start

1. `.env.local`에 템플릿을 병합합니다.
2. `docker-compose.core-only.yml` 기준으로 `zkstack-core`, `zkstack-apis`를 실행합니다.
   - 예시:
     - `cp examples/zkstack/secrets.container.yaml.example <ecosystem>/chains/<chain>/configs/secrets.container.yaml`
     - `HOST_WORKSPACE_ROOT=/absolute/path/to/workspace`
     - `ZKSTACK_CONFIG_DIR=/absolute/path/to/<ecosystem>/chains/<chain>/configs`
     - `docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core up -d`
3. L1(reth)와 Postgres는 `zkstack ecosystem init --dev`가 만든 기본 compose를 사용합니다.
4. probe 서버를 실행합니다.
   - `npm run probe:zk:settlement`
5. SentinAI를 실행합니다.
   - `npm run dev`

## Notes

- `external/zkstack-local/...` 경로는 참고용입니다. 운영 템플릿은 이 폴더 기준으로 관리합니다.
- `ZK_BATCHER_STATUS_URL`가 없으면 settlement 카드는 숨김 처리됩니다.
- `ORCHESTRATOR_TYPE=docker`로 전환하면 service mapping(`ZKSTACK_*_SERVICE`)을 적용할 수 있습니다.
- core-only 템플릿의 기본 매핑은 `execution/batcher/prover` 모두 `zkstack-core`입니다.
