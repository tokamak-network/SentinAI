# OP Stack Integration Template for SentinAI

이 폴더는 로컬 OP Stack 체인을 SentinAI에 연결하기 위한 표준 예제 템플릿입니다.

## Files

- `.env.example`: SentinAI + OP Stack 연동 기본 환경 변수 템플릿

## Quick Start

1. OP Stack 체인을 실행합니다. (`op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger` 포함)
2. `examples/opstack/.env.example` 값을 참고해 `.env.local`을 설정합니다.
3. SentinAI를 실행합니다.
   - `npm run dev`
4. 연동 상태를 검증합니다.
   - `curl -s http://localhost:3002/api/metrics`

## Notes

- `DOCKER_COMPOSE_FILE`은 실제 OP Stack compose 파일 절대경로로 지정해야 합니다.
- Docker 서비스명이 기본 컴포넌트명(`op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger`)과 다르면 현재 상태 수집/액션이 일부 제한될 수 있습니다.
- dispute game 모니터링을 쓰려면 `FAULT_PROOF_ENABLED=true`와 `DISPUTE_GAME_FACTORY_ADDRESS` 설정이 필요합니다.
