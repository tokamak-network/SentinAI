# L1 EVM 클라이언트 & L2 운영 이슈 10년사 (2016–2026): 사례별 분석 및 대응 가이드

지난 10년간 이더리움 L1 실행 클라이언트와 L2 롤업 운영에서 발생한 주요 사고는 **클라이언트 합의 버그로 인한 체인 스플릿, 중앙화된 시퀀서 장애, 브릿지 취약점, 그리고 Fault Proof 시스템의 미성숙**이라는 네 가지 축으로 수렴한다. 2016년 Shanghai DoS 공격부터 2025년 Pectra 업그레이드까지, 모든 주요 하드포크에서 최소 하나 이상의 클라이언트 호환성 문제가 발생했으며, L2에서는 시퀀서 다운타임이 전체 사고의 **59.4%**를 차지한다. 이 레포트는 L1 EVM 클라이언트(Geth, Nethermind, Besu, Erigon, op-geth, op-reth)와 L2 스택(Optimism, Arbitrum, zkSync Era, Polygon zkEVM)에서 확인된 30건 이상의 주요 사고를 연대순·카테고리별로 분석하고, 각 사례의 근본 원인, 대응, 재발 방지 조치를 실무자가 즉시 참고할 수 있는 수준으로 정리한다.

---

## Part 1: L1 EVM 클라이언트 합의 버그와 체인 스플릿

### 2016년 Shanghai DoS 공격 — 가스 비용 재조정의 기원

**사건 개요:** 2016년 9월 18일~10월, DevCon 2 기간 중 이더리움 메인넷에 대규모 DoS 공격이 발생했다. 공격자는 **EXTCODESIZE(20 gas), BALANCE(20 gas), CALL(40 gas)** 등 디스크 I/O를 유발하면서도 극히 저렴한 opcode를 수백만 회 호출하여 네트워크를 마비시켰다. 수백만 개의 빈 계정이 생성되어 state trie가 급격히 비대해졌다.

**근본 원인:** opcode 가스 비용이 실제 연산 비용과 극심하게 괴리되어 있었다. EXTCODESIZE는 SSD 읽기를 유발하면서도 20 gas에 불과했고, CALL은 40 gas만으로 상태 접근이 가능했다. 콜스택 깊이 제한(1024)도 가스 기반이 아닌 정적 제한이라 우회 가능했다.

**대응 방법:** 두 차례 하드포크로 대응했다. **Tangerine Whistle(EIP-150, 블록 2,463,000, 10월 18일)** — EXTCODESIZE 20→700, CALL 40→700, SLOAD 50→200 gas로 상향 조정하고, "all but one 64th" 가스 전달 규칙을 도입했다. **Spurious Dragon(EIP-161, 블록 2,675,000, 11월 22일)** — 빈 계정 제거 메커니즘과 24,576바이트 컨트랙트 코드 크기 제한(EIP-170)을 추가했다.

**재발 방지:** 이후 모든 새 opcode에 대해 사전 가스 비용 분석이 필수 프로세스로 정립되었다. 가스 비용 산정 시 디스크 I/O, 메모리, 연산 복잡도를 종합 고려하는 프레임워크가 수립되었다.

**레퍼런스:** EIP-150(https://eips.ethereum.org/EIPS/eip-150), Ethereum Foundation 블로그(https://blog.ethereum.org/2016/10/18/faq-upcoming-ethereum-hard-fork), Spurious Dragon 공지(https://blog.ethereum.org/2016/11/18/hard-fork-no-4-spurious-dragon)

---

### 2019년 Hyperledger Besu SELFBALANCE 합의 버그

**사건 개요:** 2019년 12월 13일, Istanbul 하드포크 이후 메인넷 블록 #9,100,883에서 Besu가 유효한 블록을 거부하며 체인에서 이탈했다.

**근본 원인:** EIP-1884로 도입된 **SELFBALANCE** opcode가 DELEGATECALL 컨텍스트에서 잘못 구현되었다. Besu는 호출자(caller) 주소 대신 컨트랙트 주소의 잔액을 반환하여, receipt root hash가 불일치했다. EIP 스펙에 DELEGATECALL 환경의 테스트 케이스가 누락된 것이 원인이었다.

**대응 방법:** 버그 발견 후 약 6시간 내에 **Besu v1.3.7**이 릴리스되었다. 12:08 PM ET 발견 → 3:31 PM 근본 원인 확인 → 5:58 PM 메인넷 동기화 복구 완료. 체인 스플릿은 발생하지 않았다(Besu가 마이닝하지 않았으므로).

**재발 방지:** CALL, CALLCODE, DELEGATECALL 등 복합 호출 컨텍스트에 대한 크로스 클라이언트 EVM 테스트 스위트가 대폭 강화되었다.

**레퍼런스:** 공식 포스트모텀(https://lf-hyperledger.atlassian.net/wiki/spaces/BESU/pages/22154199/Mainnet+Consensus+Bug+Identified+and+Resolved+in+Hyperledger+Besu)

---

### 2020년 Geth "비공개 하드포크" 체인 스플릿 — Infura 마비 사태

**사건 개요:** 2020년 11월 11일, 메인넷 **블록 11,234,873**에서 Geth 구버전(v1.9.16 이하)과 신버전(v1.9.17+) 간 체인 스플릿이 발생했다. **전체 Geth 노드의 약 54%**가 소수 체인으로 이탈했고, MetaMask·MakerDAO·Uniswap의 백본인 **Infura가 다운**되었다. Binance, Coinbase 등 주요 거래소가 ETH 출금을 중단했다.

**근본 원인:** 2019년 11월 Geth v1.9.7에서 EIP-211(RETURNDATASIZE/RETURNDATACOPY) 구현에 합의 수준 버그가 도입되었다. 2020년 7월 보안 보상 프로그램을 통해 보고되어 v1.9.17에서 **비공개 패치**되었으나, 대다수 인프라 운영자가 업그레이드하지 않은 상태에서 특정 트랜잭션이 불일치를 트리거했다.

**대응 방법:** 노드 운영자들이 v1.9.17+로 업그레이드 후 `debug.setHead(11234872)`로 롤백했다. Infura는 약 2시간 내에 근본 원인을 파악하고 복구를 시작했다.

**재발 방지:** 합의 버그의 비공개 패치 정책에 대한 격렬한 논쟁이 촉발되었다. 패치 후 최소 1개월 내 공개 의무화가 논의되었고, 주요 인프라 제공자에 대한 중요 업데이트 사전 통지 체계가 강화되었다. **Geth 모노컬처(~75% 점유율)의 체계적 리스크**가 공론화되었다.

**레퍼런스:** CoinDesk 분석(https://www.coindesk.com/tech/2020/11/11/ethereums-unannounced-hard-fork-was-trying-to-prevent-the-very-disruption-it-caused), Chainstack 타임라인(https://chainstack.com/block-11234873-and-the-geth-chain-split/)

---

### 2021년 Berlin 하드포크 — OpenEthereum 합의 오류

**사건 개요:** 2021년 4월 15일, Berlin 활성화 294블록 후(블록 12,244,294)에서 **OpenEthereum v3.2.1**(네트워크의 ~12%) 노드가 정지했다. Etherscan이 다운되고, Coinbase가 ETH 출금을 중단했다.

**근본 원인:** EIP-2929의 상태 접근 가스 비용 변경을 OpenEthereum이 부정확하게 구현했다. 특정 트랜잭션의 가스 가격 산정이 미세하게 틀려 `InvalidStateRoot` 불일치가 발생했다. Besu도 v21.1.1에서 유사 버그가 있어 v21.1.2 업그레이드가 필요했다.

**대응 방법:** OpenEthereum **v3.2.3**이 수 시간 내 릴리스되었다. 제네시스 재동기화 없이 업데이트만으로 복구 가능했다. Geth 팀의 Marius Van Der Wijden이 공동 해결에 참여했다.

**재발 방지:** 클라이언트 다양성의 중요성이 재조명되었다. OpenEthereum은 2022년 5월 공식 아카이브(deprecated)되었다. 메인넷 하드포크 전 멀티 클라이언트 테스팅 강화가 합의되었다.

**레퍼런스:** CoinDesk(https://www.coindesk.com/tech/2021/04/15/open-ethereum-clients-encounter-consensus-error-after-berlin-hard-fork-coinbase-pauses-eth-withdrawals), GitHub 이슈(https://github.com/openethereum/openethereum/issues/353)

---

### 2021년 Geth CVE-2021-39137 — EVM 메모리 손상 체인 스플릿

**사건 개요:** 2021년 8월 27일, 메인넷 **블록 13,107,518**에서 악의적으로 조작된 트랜잭션이 Geth의 EVM 메모리 손상 버그를 트리거했다. 전체 노드의 **약 50%**가 임시로 다운되었고, 소수 체인 스플릿이 발생했다. Geth 사용자의 73%(~2,858 노드)가 취약 버전을 구동 중이었다.

**근본 원인:** Geth v1.10.0~v1.10.7의 EVM 내 메모리 손상 버그(CWE-436: Interpretation Conflict)로, `EVM.Call`, `EVM.Create`, `EVM.DelegateCall` 등 핵심 함수가 영향받았다. 취약 노드는 조작된 트랜잭션 처리 시 다른 `stateRoot`를 산출했다.

**대응 방법:** 8월 18일 사전 공지 → 8월 24일 Geth **v1.10.8** 릴리스 → 8월 27일 실제 익스플로잇 발생. v1.10.8로 업그레이드한 노드는 즉시 정규 체인에 합류했다.

**재발 방지:** Telos EVM 감사 중 **Guido Vranken(Sentnl)**이 딥 퍼징으로 발견한 사례로, 체계적 퍼징과 외부 보안 감사의 가치를 입증했다. Geth 지배(74%)에 대한 체계적 리스크 경고가 강화되었다.

**레퍼런스:** GitHub Security Advisory(https://github.com/advisories/GHSA-9856-9gg9-qcmq), Geth v1.10.8 릴리스(https://github.com/ethereum/go-ethereum/releases/tag/v1.10.8), 패치 커밋(https://github.com/ethereum/go-ethereum/pull/23381/commits/4d4879cafd1b3c906fc184a8c4a357137465128f)

---

### 2022년 Besu 가스 누출 버그 (CVE-2022-36025) — Merge 직전 발견

**사건 개요:** Besu v22.4.0~v22.7.0에서 함수 호출이 전달받은 가스보다 더 많은 가스를 반환하는 버그가 존재했다. The Merge 준비를 위한 퍼징 과정에서 **Martin Holst Swende**가 발견했으며, **프로덕션 익스플로잇 전에 패치**되었다.

**근본 원인:** EIP-4803 지원을 위해 내부 `Gas` 타입을 `UInt256`에서 네이티브 `long`(signed)으로 마이그레이션하면서, unsigned 데이터가 signed로 잘못 처리되었다. EIP-150의 "all but one 64th" 규칙과 결합 시 사실상 무한 루프가 가능했다.

**대응 방법:** Besu **v22.7.1**에서 오버플로우 값을 최대 기대값으로 클램핑하는 변환 메서드를 적용하여 수정했다.

**재발 방지:** EIP-3155 표준 트레이스를 활용한 크로스 클라이언트 퍼징의 가치가 입증되었다. 타입 변환, 특히 signed/unsigned 경계에서의 테스팅 강화가 권고되었다.

**레퍼런스:** 상세 분석(https://hackmd.io/@shemnon/besu-gas-leak), CVE-2022-36025(https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2022-36025)

---

### 2024년 1월 Nethermind 합의 버그 — revert 메시지 파싱의 함정

**사건 개요:** 2024년 1월 21일 18:06:23 UTC, Nethermind v1.23.0~v1.25.1이 유효한 메인넷 블록을 무효로 처리하여 **전체 밸리데이터의 약 8.2%**가 어테스테이션을 중단했다.

**근본 원인:** PR #6226에서 Solidity 0.8.0+ panic 에러 코드를 디코딩하여 UX를 개선하려는 코드가 추가되었다. 특정 트랜잭션의 revert 메시지 디코딩 과정에서 **처리되지 않은 OverflowException**이 발생하여 트랜잭션이 전체 가스를 소모하며 실패, 다른 블록 해시를 생성했다. **합의에 영향을 주지 않아야 할 UX 코드가 합의를 깨뜨린 사례**다.

**대응 방법:** Discord 커뮤니티에서 발견 → Nethermind 팀 리드 확인 → EF DevOps(Parithosh)과 Geth 팀(Marius) 합류 → 결함 PR 롤백 → **Nethermind v1.25.2**가 약 4~5시간 내 릴리스되었다. 재동기화 불필요.

**재발 방지:** EVM 및 합의 관련 코드 변경에 대한 엄격한 리뷰 요건이 강화되었다. 비합의 코드 경로도 트랜잭션 실행에 영향을 줄 수 있다는 교훈이 공유되었다.

**레퍼런스:** 포스트모텀(https://hackmd.io/@nethermindclient/ByW9sX_R6), GitHub 이슈(https://github.com/NethermindEth/nethermind/issues/6707), v1.25.2 릴리스(https://github.com/NethermindEth/nethermind/releases/tag/1.25.2), 결함 PR(https://github.com/NethermindEth/nethermind/pull/6226)

---

### 2025년 Pectra 업그레이드 테스트넷 실패와 Reth 스테이트 루트 버그

**Pectra 테스트넷 이슈:** 2025년 2월 24일 Holesky 테스트넷에서 Pectra 활성화 시, **Geth·Nethermind·Besu가 잘못된 deposit 컨트랙트 주소**를 사용하여 Pectra 요청 해시 계산이 틀어지면서 합의 실패가 발생했다. 소수 클라이언트인 **Erigon과 Reth만 올바른 블록을 생성**했고, 약 2주간 Holesky의 finality가 상실되었다. 3월 5일 Sepolia에서도 커스텀 deposit 컨트랙트 문제로 빈 블록이 생성되었다. 이로 인해 새 테스트넷 **Hoodi**가 생성되었고, 5월 7일 메인넷 배포는 성공적으로 완료되었다.

**Reth 스테이트 루트 버그(2025년 9월):** Reth v1.4.8/v1.6.0에서 state root 계산 버그로 블록 2,327,426에서 노드가 정지했다. 실행 레이어 노드의 **5.4%**가 영향받았으나, 클라이언트 다양성 덕분에 네트워크는 정상 운영되었다.

**레퍼런스:** Blockdaemon 분석(https://www.blockdaemon.com/blog/ethereums-pectra-upgrade-navigating-the-testnet-incidents), EF 블로그(https://blog.ethereum.org/2025/04/23/pectra-mainnet), Reth 버그(https://www.theblock.co/post/369246/reth-client-state-root-bug)

---

## Part 2: Optimism / OP Stack 운영 이슈 전수 분석

### 2021~2022년 OVM에서 EVM으로의 대전환 — Regenesis

**사건 개요:** Optimism은 2021년 4월(12시간 다운) 및 11월 11일(최종 Regenesis)에 OVM 1.0에서 EVM Equivalence(OVM 2.0)로 전환했다. 최종 Regenesis 시 **전체 트랜잭션 히스토리가 삭제**되었고, 네트워크 상태만 새 제네시스 블록으로 이전되었다.

**근본 원인:** OVM 1.0은 Execution Manager를 통한 커스텀 VM으로, 포크된 Solidity 컴파일러(~500줄 수정)가 필요했고, 컨트랙트 크기 제약·금지 opcode·커스텀 가스 모델 등 기술 부채가 누적되었다.

**대응 방법:** Synthetix 등 파트너 프로토콜과 호환성 검증 수행, SIP-182 리뷰 체크리스트 작성, 스테이징 환경 확장 시험, Dune Analytics 스냅샷으로 히스토리 보존 시도.

**재발 방지:** EVM Equivalence를 설계 철학으로 채택하여 upstream go-ethereum과의 diff를 최소화했고, Bedrock Edition 계획이 즉시 시작되었다.

**레퍼런스:** EVM Equivalence 소개(https://medium.com/ethereum-optimism/introducing-evm-equivalence-5c2021deb306), Regenesis 리포(https://github.com/ethereum-optimism/regenesis)

---

### 2022년 2월 SELFDESTRUCT 무한 ETH 생성 버그 — $530M TVL 위기

**사건 개요:** 2022년 2월 2일 보고, 10일 공개. Optimism의 l2geth(OVM 2.0)에서 **SELFDESTRUCT 실행 시 ETH가 이중 생성**되는 치명적 취약점이 발견되었다.

**근본 원인:** SELFDESTRUCT 시 잔액을 `stateObject`에서 직접 0으로 설정하면서, OVM_ETH ERC-20 스토리지의 잔액은 변경하지 않았다. 자기 자신을 수혜자로 지정하고 반복 호출하면 **기하급수적으로 자금이 복제**되었다. 2021년 크리스마스 이브에 Etherscan 직원이 우연히 트리거한 적이 있으나 악용되지 않았다.

**대응 방법:** 확인 수 시간 내 Kovan 테스트넷과 메인넷에 수정 배포. Infura·QuickNode·Alchemy 등 모든 인프라 제공자 패치. 다운스트림 포크(Boba, Metis) 및 브릿지 제공자에 알림. **$2,000,042 최대 버그 바운티**가 Jay Freeman(saurik)에게 지급되었다(Immunefi 경유, Boba 추가 $100,000).

**재발 방지:** Bedrock Edition 개발 가속화(upstream go-ethereum diff 최소화), 버그 바운티 프로그램 강화.

**레퍼런스:** Optimism 공개(https://medium.com/ethereum-optimism/disclosure-fixing-a-critical-bug-in-optimisms-geth-fork-a836ebdf7c94), saurik 분석(https://www.saurik.com/optimism.html), Immunefi 리뷰(https://medium.com/immunefi/optimism-infinite-money-duplication-bugfix-review-daa6597146a0)

---

### 2022년 6월 Wintermute 20M OP 토큰 유출 사건

**사건 개요:** Optimism이 마켓 메이커 Wintermute에게 할당한 **2,000만 OP 토큰(~$15-17M)**이 탈취되었다. Wintermute가 L1에만 배포된 Gnosis Safe 멀티시그 주소를 L2 수령 주소로 제공한 것이 발단이었다.

**근본 원인:** 공격자는 L1의 Gnosis Safe ProxyFactory 배포 트랜잭션을 L2에 **리플레이 공격**으로 재현했다(배포자가 pre-EIP-155 트랜잭션을 사용하여 chainID가 없었음). 10,044개의 멀티시그 컨트랙트를 팩토리를 통해 생성하여 동일 nonce/주소에 도달, 20M OP에 대한 통제권을 획득했다.

**대응 방법:** 공격자가 1M OP를 720.7 ETH로 매도, 1M OP를 Vitalik에게 전송한 후, **17M OP를 반환**(화이트햇). Optimism은 하드포크를 통한 동결을 **거부**하며 "중앙화된 통제로 부분 복구를 시도하면 중대한 선례가 될 것"이라 밝혔다. Wintermute에 추가 20M OP 부여($50M USDC 담보).

**재발 방지:** 토큰 전송 전 대상 체인의 컨트랙트 배포 상태 검증 절차 강화.

**레퍼런스:** Optimism 공지(https://plaid-cement-e44.notion.site/A-Message-to-the-Community-from-the-Optimism-Foundation-f49b913bb0974d8a854a8bdd409a9dd6), Inspex 기술 분석(https://inspexco.medium.com/how-20-million-op-was-stolen-from-the-multisig-wallet-not-yet-owned-by-wintermute-3f6c75db740a)

---

### 2023년 6월 Bedrock 업그레이드와 2024년 Fault Proof 시스템 사이클

**Bedrock 업그레이드(2023년 6월 6일):** OP Stack의 첫 공식 릴리스로, 전체 체인 데이터를 보존하면서 아키텍처를 근본적으로 재설계했다. **계획된 2~4시간 다운타임**, 가스 비용 47% 절감, 입금 확인 시간 ~10분→~3분으로 단축, 트랜잭션당 1블록→다중 블록 모델 전환, EIP-1559 지원 추가. 업그레이드 후 MetaMask에서 가스 표시 버그 발생(매우 낮은 L2 가스 비용으로 인한 반올림 문제).

**Fault Proof 활성화(2024년 6월 10일):** OP Mainnet에서 허가 없는(permissionless) Fault Proof가 활성화되어 "Stage 1 탈중앙화"에 도달했다. DisputeGameFactory와 FaultDisputeGame 컨트랙트를 통해 누구나 상태 제안을 제출·도전할 수 있게 되었다.

**Fault Proof 버그 및 롤백(2024년 8월):** Spearbit·Cantina·Code4rena의 커뮤니티 보안 감사에서 **두 건의 고위험 취약점**이 발견되었다. OptimismPortal2의 unsafe uint8 cast(GameType 256이 type 0으로 처리되어 오프체인 모니터링 우회 가능), 게임 클럭 조작 벡터, 부정확한 게임 해결 등이 포함되었다. **실제 익스플로잇은 없었으나**, Guardian 역할이 활성화되어 허가형 폴백으로 복원했다. 모든 대기 중 출금이 무효화되어 재증명 및 추가 7일 대기가 필요했다.

**Granite 하드포크(2024년 9월 11일):** 모든 식별된 취약점 수정 + L2 하드포크를 포함하여, 허가 없는 Fault Proof를 **재활성화**했다.

**레퍼런스:** Fault Proof 문서(https://docs.optimism.io/op-stack/fault-proofs/explainer), Granite 변경사항(https://docs.optimism.io/builders/notices/granite-changes), Sherlock 감사(https://github.com/sherlock-audit/2024-02-optimism-2024-judging), Code4rena 콘테스트(https://github.com/code-423n4/2024-07-optimism), 출금 무효화 이슈(https://github.com/ethereum-optimism/optimism/issues/12175)

---

### OP Stack 체인(Base) 시퀀서 장애 사례

**Base 최초 장애(2023년 9월 5일):** 퍼블릭 론칭 약 1개월 후, 내부 인프라 리프레시 필요로 **~45분간 블록 생산 중단**.

**Base op-conductor 장애(2024년 9월 21일):** 전일 단일 시퀀서에서 **op-conductor HA 클러스터**로 마이그레이션했으나, op-node가 op-conductor에 새 unsafe 블록 페이로드를 제출하지 않도록 잘못 구성되었다. 활성 시퀀서 이상 시 페일오버 불가. **17분간 블록 생산 중단**. 수동 블록 생산 재개 후 단일 시퀀서로 임시 복귀. 이후 op-node와 op-conductor 간 양방향 핸드셰이크가 구현되었다.

**Base 트래픽 장애(2025년 8월 5일):** Zora/Farcaster 크리에이터 이코노미로 인한 고부하(일 50,000+ 토큰 론칭)에서 활성 시퀀서가 지연되었고, op-conductor가 아직 프로비저닝 중인 백업 시퀀서를 선출하여 **33분간 전체 운영 중단**. TVL $4.1B 규모에서 발생. Chainlink Sequencer Uptime Feed 서킷 브레이커 덕분에 Aave·Moonwell 등에서 청산 오류는 없었다.

**레퍼런스:** Base 포스트모텀(https://blog.base.org/base-mainnet-092124-incident-postmortem), CoinDesk(https://www.coindesk.com/tech/2025/08/06/base-says-sequencer-failure-caused-block-production-halt-of-33-minutes)

---

### op-geth, op-node, op-batcher 운영 이슈 패턴

OP Stack 구성 요소에서 반복적으로 확인되는 운영 이슈 패턴이 있다. **op-batcher 중단 시 대규모 리오그 발생**(1일 이상 중단 시 L2 safe/finalized 헤드가 최신 블록을 따라잡지 못함, GitHub #11234), **op-node의 L1 RPC 장애 시 시퀀서 영구 정지**(자동 복구 불가, 수동 개입 필요, GitHub #12740), **op-proposer 자금 고갈 후 재충전 시 블록 해시 불일치로 정지**(GitHub #7897), **op-batcher Pectra 가스 플로어 미호환**(GitHub #14513). 이들은 OP Stack 운영자가 반드시 모니터링해야 할 알려진 장애 모드다.

---

## Part 3: Arbitrum 운영 장애와 프로토콜 진화

### 2021~2022년 시퀀서 다운타임 — 초기 안정화 과정

**최초 시퀀서 장애(2021년 9월 14일):** 대량 트랜잭션 버스트를 처리하던 중 소프트웨어 버그로 **~45분간 시퀀서 정지**. 이전에 수락된 모든 트랜잭션은 보존되었고 순서 변경 없이 복구되었다.

**장기 장애(2022년 1월 9일):** 메인 시퀀서 노드의 **하드웨어 장애** 발생. 백업 시퀀서도 소프트웨어 업그레이드 진행 중이어서 실패. **약 7시간 완전 정지**. Offchain Labs는 284건의 미게시 트랜잭션을 먼저 L1에 게시한 후 전체 복구를 진행, 리오그 없이 완료했다.

**레퍼런스:** 2021년 포스트모텀(https://medium.com/offchainlabs/arbitrum-one-outage-report-d365b24d49c), 2022년 포스트모텀(https://offchain.medium.com/todays-arbitrum-sequencer-downtime-what-happened-6382a3066fbc)

---

### 2022년 9월 Nitro 브릿지 초기화 취약점 — 잠재적 $250M+ 위험

**사건 개요:** Nitro 마이그레이션(2022년 8월 31일) 직후, 화이트햇 해커 **0xriptide**가 L1↔L2 브릿지 컨트랙트에서 초기화 관련 취약점을 발견했다.

**근본 원인:** 브릿지 컨트랙트가 이미 초기화되었음에도 입금을 수락하는 상태였다. 공격자가 자신의 주소를 브릿지로 설정하여 실제 컨트랙트를 모방하면 **모든 L1→L2 ETH 입금을 탈취** 가능했다. 취약점 기간 중 최대 단일 입금은 ~168,000 ETH(~$250M)이었다.

**대응 방법:** **400 ETH(~$520,000) 바운티** 지급. 취약점 패치 완료. 0xriptide는 심각도 대비 바운티가 부족하다고 공개 이의를 제기했다.

**레퍼런스:** The Block(https://www.theblock.co/post/171585/arbitrum-announces-400-eth-bug-bounty-payout), ImmuneFi(https://immunefi.com/bug-bounty/arbitrum/)

---

### 2023년 Inscription 트래픽 급증으로 인한 시퀀서 마비

**사건 개요:** 2023년 12월 15일, Ethscriptions(Bitcoin Ordinals 영감) 트래픽이 Arbitrum 전체 트래픽의 **90% 이상**을 점유하며 데이터 부하가 정상 ~3MB/hr에서 **80MB/hr**로 급증했다.

**근본 원인:** 배치 포스터에 **L1 mempool 대기 배치 10개 상한**이 하드코딩되어 있었다. 비압축성 inscription 데이터로 배치 크기가 커지면서 한계에 도달, 시퀀서가 정지했다. 초기 장애 ~3시간, 이후 비정상 가스 가격 지속, 2차 장애 ~4시간 추가 발생.

**대응 방법:** 대기 배치 한도를 10→20으로 상향. Dedaub의 독립 분석에서 L2 calldata 가스 가격이 너무 낮을 수 있다는 점, 비압축성 데이터의 배치 크기 영향을 고려한 스트레스 테스트 필요성이 권고되었다.

**레퍼런스:** Arbitrum 상태(https://status.arbitrum.io/clq6te1l142387b8n5bmllk9es), Dedaub 분석(https://dedaub.com/blog/arbitrum-sequencer-outage/), CoinDesk(https://www.coindesk.com/tech/2023/12/15/arbitrum-hit-by-partial-outage-due-to-traffic-surge)

---

### 2024년 Stylus DoS 취약점과 2025년 BOLD 배포

**Stylus 무효 import DoS(2024년 9월):** WASM 모듈 import 검증의 논리 결함으로 시퀀서를 **가스 비용 없이 반복 크래시** 가능한 취약점이 발견되었다. `FORWARDING_PREFIX`(`arbitrator_forward__`)를 제거한 후 유효 함수 이름을 얻지만, 실제 import는 존재하지 않아 실행 시 `unknown import` 패닉이 발생했다. **스텔스 완화**(메인넷 시퀀서 업데이트) 후 Nitro v3.2.0에서 완전 수정. **$80,000 바운티** 지급.

**BOLD 배포(2025년 2월 12일):** Arbitrum One과 Nova에 **허가 없는 검증(permissionless validation)**이 활성화되었다. 기존 허용 목록 기반 밸리데이터 + 지연 공격 취약 프로토콜을 대체하여, 단일 정직 참여자가 모든 적대자를 최대 ~14일 내에 패배시킬 수 있다. 어설션 포스터 본드 **$3.7M+ USD** 요구, Trail of Bits 감사 완료.

**레퍼런스:** iosiro 공개(https://iosiro.com/blog/arbitrum-stylus-invalid-import-denial-of-service), BOLD 문서(https://docs.arbitrum.io/how-arbitrum-works/bold/gentle-introduction), BOLD AIP(https://forum.arbitrum.foundation/t/aip-bold-permissionless-validation-for-arbitrum/23232)

---

## Part 4: ZK 롤업 — 증명 시스템의 취약성과 운영 성숙도

### 2023년 zkSync Era — 론칭 초기 연쇄 장애

zkSync Era는 2023년 3월 24일 "Alpha" 라벨로 론칭하며 $3.8M을 테스팅·감사에 투입했으나, 초기 수개월간 다수의 장애가 발생했다. **4월 1일** 서버 측 버그로 ~4시간 블록 생산 중단, **4월 6~7일** GemholicECO IDO 컨트랙트에서 Solidity `.transfer()`의 2,300 gas 제한이 zkSync Era의 동적 가스 모델과 충돌하여 **921 ETH(~$1.7M)가 잠김**(이후 프로토콜 가스 미터링 변경으로 해결), **5월 2일** 증명 생성 파이프라인 버그로 출금 처리 지연, **12월 25일** 운영자 상태 업데이트 연산의 에지 케이스 버그로 과도하게 방어적인 안전 프로토콜이 트리거되어 **~5시간 완전 정지**.

**레퍼런스:** GemholicECO 분석(https://medium.com/coinmonks/gemstoneido-contract-stuck-with-921-eth-an-analysis-of-why-transfer-does-not-work-on-zksync-era-d5a01807227d), 크리스마스 장애(https://beincrypto.com/layer-2-zksync-post-mortem-christmas-network-outage/)

---

### 2023년 11월 ChainLight의 zkSync Era zk-circuit 취약점 — 잠재적 $1.9B 위험

**사건 개요:** ChainLight이 zkSync Era의 **zk-circuit soundness 버그**를 발견했다. 공격자가 블록 내 트랜잭션 데이터를 조작하면서도 L1 스마트 컨트랙트가 유효하다고 수락하는 증명을 생성할 수 있었다.

**근본 원인:** 구형 프루버(Boojum 이전)의 회로 로직에서 트랜잭션 데이터 무결성 검증이 불완전했다. 최대 **100,000 ETH(~$1.9B)**를 허위 출금으로 탈취 가능했으나, 백엔드 접근/밸리데이터 프라이빗 키가 필요했고 21시간 실행 지연이 존재했다.

**대응 방법:** 즉시 수정. ChainLight에 **$50,000 USDC 바운티** 지급. Boojum 프루버 전환으로 취약 코드가 폐기되었다.

**레퍼런스:** Blockworks 분석(https://blockworks.co/news/exploit-bug-zksync-matter-labs), PoC(https://github.com/chainlight-io/zksync-era-write-query-poc)

---

### 2023년 9월 Polygon zkEVM 증명 위조 취약점

**사건 개요:** Verichains가 Polygon zkEVM의 **zkProver**에서 재귀적 증명 생성(STARK→SNARK 변환) 과정의 치명적 취약점을 발견했다. 2023년 9월 발견, 12월 메인넷 수정, 2024년 3월 공개.

**근본 원인:** 두 가지 수학적 약점이 존재했다. Fp³ 원소(~192비트)를 Fq 원소(~254비트)로 변환 시 x, y, z 값을 64비트로 제약하지 않아 임의 Fq 원소 삽입 가능. 곱셈-덧셈 연산에서 세 번째 피연산자에 초과 공간이 할당되어 악용 가능한 slack 생성. 이를 통해 **위조 ZK 증명으로 StateRoot와 LocalExitRoot를 임의 값으로 조작** 가능했다.

**대응 방법:** Immunefi를 통해 보고. GL 필드 연산 제약 추가(`GLSub`, `GLAdd` 템플릿), `recursiveF` 검증 회로 입력을 2^64 미만으로 제한하는 수정이 12월 메인넷에 배포되었다.

**레퍼런스:** Verichains 공개(https://blog.verichains.io/p/discovering-and-fixing-a-critical), GitHub PR(https://github.com/0xPolygonHermez/pil-stark/pull/51)

---

### 2024년 3월 Polygon zkEVM 대규모 장애 — 최초 긴급 상태 발동

**사건 개요:** 2024년 3월 23일, **~10~14시간 블록 생산 완전 중단**. Polygon zkEVM **최초의 긴급 상태(emergency state) 발동** 사례.

**근본 원인:** **이더리움 L1 리오그**가 Polygon zkEVM 입금 트랜잭션을 누락시켰다. L2 synchronizer가 이 리오그를 적시 감지하지 못하여 시퀀서가 잘못된/만료된 타임스탬프로 트랜잭션을 정렬했다. 메인넷에 배치된 트랜잭션이 기대 타임스탬프 불일치로 거부되어 no-op 처리되었다.

**대응 방법:** Security Council(6/8 멀티시그)이 긴급 상태 승인 → 정상 10일 타임락 우회 → 프루버·검증자·시퀀서 업그레이드 → 긴급 상태 해제. 시퀀서에 메인넷 타임스탬프 이중 확인 기능 추가.

**레퍼런스:** Blockworks 포스트모텀(https://blockworks.co/news/polygon-zkevm-post-mortem), Unchained(https://unchainedcrypto.com/polygon-zkevm-chain-goes-down-for-10-hours/)

---

### 2025년 zkSync 에어드롭 관리자 키 해킹과 Polygon zkEVM 일몰

**zkSync 에어드롭 해킹(2025년 4월 15일):** 에어드롭 배포 컨트랙트 3개의 **관리자 프라이빗 키가 탈취**되어 `sweepUnclaimed()` 함수로 미수령 ZK 토큰 ~1.11억 개(~$5M)가 민팅되었다. 코어 프로토콜과 사용자 자금은 영향 없음. 공격자는 safe harbor 프레임워크 하에 **10% 바운티 수령, 90%($5.7M) 반환**.

**Polygon zkEVM 일몰 발표(2025년 6월 11일):** EIP-4844 통합 지연, ZK 카운터 제한으로 인한 복잡한 DeFi 실행 불가, 차별화 난이도, 저조한 채택(연간 $1M+ 손실)을 이유로 **2026년 메인넷 종료**를 발표. Jordi Baylina(zkEVM 리드)가 독립 스타트업 **ZisK**로 분사.

**레퍼런스:** Halborn 분석(https://www.halborn.com/blog/post/explained-the-zksync-hack-april-2025), Polygon 포럼(https://forum.polygon.technology/t/sunsetting-polygon-zkevm-mainnet-beta-in-2026/21020)

---

## Part 5: 구조적 리스크 — 시퀀서 중앙화, 브릿지, 클라이언트 다양성

### 중앙화된 시퀀서라는 단일 장애점

2016~2025년 문서화된 L2 사고 32건 중 **59.4%가 시퀀서 장애**, **18.8%가 출금/브릿지 장애**였다(arXiv:2512.12732 분석). 모든 주요 L2(Arbitrum, Optimism, Base, zkSync, StarkNet)가 단일 중앙화 시퀀서를 운영하며, 이는 라이브니스 단일 장애점, 검열 리스크, MEV 추출 가능성을 내포한다. Base의 중앙화 시퀀서는 2024년 3월 기준 연간 **~$360M의 시퀀서 수수료**를 생성했다. 2024년 6월 Linea(ConsenSys)는 익스플로잇 후 시퀀서를 **일방적으로 중단하고 공격자 주소를 검열**하여, 중앙화 시퀀서가 사실상 검열 도구임을 입증했다.

탈중앙화 시퀀서 로드맵은 Arbitrum(BOLD 이후 시퀀서 분산 예정), Optimism(시퀀서 로테이션/리더 선출 계획), zkSync(2025년 말 멀티노드 테스트넷 목표)로 진행 중이나, 아직 프로덕션 수준에 도달한 프로젝트는 없다.

---

### 브릿지 보안 모델과 상태 루트 의존성

L2 브릿지의 보안은 전적으로 **상태 루트의 정확성과 제안자(proposer)의 라이브니스**에 의존한다. Optimistic 롤업은 ~7일 챌린지 기간 동안 아무도 잘못된 상태 루트에 이의를 제기하지 않으면 확정되어 자금 탈취가 가능하다. ZK 롤업은 유효성 증명을 제출하지만 중앙화된 프루버 인프라에 의존한다. 129개 L2 프로젝트 분석에서 **86%가 탈출 기간 없이 즉시 업그레이드 가능**, **50.4%가 제안자 장애 시 출금 동결 취약**, **13.2%가 신뢰할 수 있는 강제 포함 경로 부재**로 나타났다. L2BEAT 프레임워크 기준, Stage 2(완전 신뢰 불필요)에 도달한 롤업은 **아직 존재하지 않는다**.

**레퍼런스:** Quantstamp L2 보안 프레임워크(https://github.com/quantstamp/l2-security-framework), L2BEAT(https://l2beat.com/scaling/projects/polygonzkevm), 학술 분석(https://arxiv.org/html/2512.12732v1)

---

### Geth 지배의 체계적 리스크와 클라이언트 다양성 진전

Geth는 2024년 초 실행 레이어의 **~85-87%**를 점유했다. Geth가 66% 이상을 점유한 상태에서 합의 버그가 발생하면 잘못된 체인이 확정(finalize)될 수 있으며, 정규 체인 복귀 시 **비활동 누출 패널티**, 66% 동시 슬래싱 시 **전체 32 ETH 스테이크 몰수**가 적용된다.

2024년 1월 Besu(~4%)와 Nethermind(~8%) 연속 버그는 소수 클라이언트였기에 관리 가능했으나, Geth 85%에서 동일 버그 발생 시의 결과는 재앙적이었을 것이다. 이후 Lido가 Geth 비율을 93%(2022)→46.6%(2024 Q1)로 감축, Coinbase가 Nethermind·Erigon 다양화를 시작, 2024년 중반 Vitalik은 **최초로 어떤 실행 클라이언트도 2/3를 초과하지 않는** 이정표를 언급했다. 2025년 10월 기준 Geth ~58-63%, Nethermind 2위, Besu 3위, Erigon 4위, Reth ~5.4%로 분포한다.

**레퍼런스:** clientdiversity.org(https://clientdiversity.org/), execution-diversity.info(https://execution-diversity.info/)

---

### op-reth의 성숙도와 현재 이슈

OP Stack의 대안 실행 클라이언트인 op-reth(Paradigm의 Reth 기반)는 2024년 6월 v1.0 "프로덕션 레디"로 릴리스되었으나, 여전히 다수의 프로덕션급 이슈가 보고된다. OP Canyon 업데이트 후 Shanghai EIP-4895 출금 미처리(GitHub #6036), Bedrock 상태 임포트 후 패닉(#9725), Optimism Mainnet 실행 스테이지 영구 정지(#9796), op-batcher와의 `miner_setMaxDASize` 반환 타입 불일치(#13422), 프루닝 활성화 시 128GB RAM에서도 OOM(#19128) 등이 확인되었다.

---

## 결론: 10년의 교훈과 구조적 과제

이 레포트에서 분석한 30건 이상의 사례는 몇 가지 근본적 패턴을 반복적으로 드러낸다.

**클라이언트 다양성은 이더리움의 가장 중요한 방어선이다.** 2020년과 2021년 Geth 체인 스플릿, 2021년 OpenEthereum 장애, 2024년 Nethermind 버그, 2025년 Pectra 테스트넷 실패 — 모든 사례에서 소수 클라이언트의 존재가 네트워크 전체 붕괴를 막았다. 단일 클라이언트의 66% 초과는 확정성(finality) 수준의 체계적 리스크다.

**비합의 코드가 합의를 깨뜨릴 수 있다.** Nethermind의 revert 메시지 파싱 UX 코드가 합의 실패를 야기한 사례는, 실행 클라이언트의 모든 코드 변경이 잠재적 합의 영향을 갖는다는 경고다.

**L2의 중앙화된 시퀀서는 근본적 단일 장애점으로 남아 있다.** 10년간의 L2 사고 중 60%가 시퀀서 관련이며, Linea의 일방적 검열 사례는 이론적 리스크가 현실임을 증명했다. BOLD와 Optimism Fault Proof의 활성화는 검증을 탈중앙화했지만, 트랜잭션 정렬의 탈중앙화는 아직 미해결이다.

**ZK 롤업의 증명 시스템은 여전히 성숙 중이다.** zkSync의 zk-circuit soundness 버그($1.9B 잠재 위험)와 Polygon zkEVM의 증명 위조 취약점은 수학적 정확성의 실무적 검증이 얼마나 어려운지를 보여준다. Polygon zkEVM의 2026년 일몰 결정은 ZK 기술의 프로덕션 준비도에 대한 냉정한 시그널이다.

**하드포크마다 최소 하나의 클라이언트 문제가 발생한다.** Shanghai, Berlin, London, The Merge, Dencun, Pectra — 모든 주요 업그레이드에서 클라이언트 호환성 이슈가 확인되었다. 이는 멀티 클라이언트 테스팅 인프라와 테스트넷 검증의 지속적 강화가 필수임을 의미한다. Pectra의 경로(2개 테스트넷 실패 → 신규 테스트넷 → 성공적 메인넷)는 올바른 접근법의 모범 사례다.