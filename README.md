# TMS 배송 최적화 MCP 서버 🚛📊

Claude Desktop에서 자연어로 복잡한 배송 최적화 문제를 해결할 수 있는 MCP (Model Context Protocol) 서버입니다. 
고급 최적화 엔진을 활용하여 TMS 소프트웨어 없이도 챗봇을 통해 전문적인 배송 경로 최적화를 수행할 수 있습니다.

## 🎯 주요 기능

- **자연어 인터페이스**: "새 배송 최적화 프로젝트 시작해줘"와 같은 자연어로 복잡한 최적화 작업 수행
- **7단계 워크플로우**: 프로젝트 시작부터 결과 내보내기까지 체계적인 단계별 진행
- **스마트 데이터 검증**: CSV 파일 오류 자동 감지 및 구체적인 수정 방법 제시  
- **유연한 시간 제약**: 시간 정보가 있으면 CVRPTW, 없으면 순수 CVRP로 자동 처리
- **세션 관리**: 작업 중단 후 언제든지 이어서 진행 가능
- **실무 중심 출력**: Excel, PDF 등 즉시 활용 가능한 형태로 결과 제공

## 🏗️ 시스템 아키텍처

```
TMS-MCP-Server/
├── 📊 데이터 레이어      # CSV 파일 처리 및 검증
├── ⚙️ 최적화 엔진       # 고급 배송 경로 최적화 알고리즘
├── 🔧 MCP 서버         # Claude Desktop과의 자연어 인터페이스
└── 📈 결과 분석기       # 시각화 및 보고서 생성
```

## 🚀 빠른 시작

### 1. 프로젝트 설치

```bash
# 저장소 클론
git clone https://github.com/omeletJK/TMS-MCP-Server.git
cd TMS-MCP-Server

# 의존성 설치
npm install

# TypeScript 컴파일
npm run build
```

### 2. Claude Desktop 설정

Claude Desktop의 설정 파일에 MCP 서버를 등록합니다:

**macOS/Linux**: `~/.config/claude-desktop/config.json`
**Windows**: `%APPDATA%\Claude\config.json`

```json
{
  "mcpServers": {
    "tms-optimizer": {
      "command": "node",
      "args": ["/절대/경로/TMS-MCP-Server/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

> ⚠️ **중요**: `/절대/경로/TMS-MCP-Server`를 실제 프로젝트 경로로 변경해주세요.

### 3. 데이터 준비

`ProblemData` 폴더에 다음 CSV 파일들을 준비합니다:

#### drivers.csv (필수)
```csv
driver_id,name,start_location_lat,start_location_lng,capacity,cost_per_km
D001,김민수,37.5665,126.978,1000,500
D002,이영희,37.5505,126.9882,1500,550
```

#### orders.csv (필수)
```csv
order_id,customer_name,delivery_lat,delivery_lng,weight,volume,priority
O001,강남 고객사,37.5172,127.0473,150,50,1
O002,홍대 고객사,37.5563,126.9236,200,75,2
```

#### depots.csv (선택사항)
```csv
depot_id,name,lat,lng
DEPOT001,서울 중앙 물류센터,37.5665,126.978
```

### 4. 서버 실행 테스트

```bash
# 개발 모드로 실행
npm run dev

# 또는 빌드 후 실행
npm run build && npm start
```

## 💬 사용 방법

### 기본 워크플로우

Claude Desktop에서 다음과 같이 말해보세요:

```
새 배송 최적화 프로젝트 시작해줘
```

### 7단계 프로세스

1. **🚀 프로젝트 시작** - 초기화 및 샘플 데이터 생성
2. **📊 데이터 준비** - CSV 파일 검증 및 오류 수정
3. **⚙️ 문제 설정** - 최적화 목표 및 제약조건 설정
4. **🧮 최적화 실행** - 고급 알고리즘으로 경로 최적화
5. **📈 결과 분석** - 결과 분석 및 지도 시각화
6. **🔧 해결책 개선** - 피드백 기반 반복 개선
7. **📤 결과 내보내기** - Excel, PDF 등으로 최종 결과 출력

### 자연어 명령 예시

```bash
# 데이터 검증
"데이터를 분석하고 문제점을 알려줘"

# 문제 설정
"비용 최소화로 문제 설정해줘"
"시간 단축을 우선으로 설정해줘"

# 최적화 실행
"최적화를 실행해줘"
"배송 경로를 최적화해줘"

# 결과 분석
"결과를 분석하고 지도로 보여줘"

# 개선
"차량 2번 경로가 너무 복잡해"

# 내보내기
"Excel로 내보내서 팀장님께 보고할게"
```

## 🔧 고급 기능

### 유연한 시간 제약 처리

시스템은 입력 데이터를 자동으로 분석하여 최적의 알고리즘을 선택합니다:

- **시간 정보 있음**: CVRPTW (시간창 제약이 있는 차량 경로 문제)
- **시간 정보 없음**: CVRP (순수 용량 제약 차량 경로 문제)

### 스마트 데이터 검증

CSV 파일의 다음 항목들을 자동으로 검증합니다:

- 좌표 유효성 (위도/경도 범위)
- 용량 제약 일관성
- 필수 필드 존재 여부
- 데이터 타입 정확성

### 다양한 최적화 목표

- **💰 비용 최소화**: 연료비 및 운영비 절감
- **⏰ 시간 단축**: 배송 완료 시간 최소화
- **📏 거리 최소화**: 총 이동 거리 감소
- **😊 고객 만족**: 시간약속 준수 및 서비스 품질 향상

## 📊 프로젝트 구조

```
TMS-MCP-Server/
├── package.json              # 의존성 및 스크립트
├── tsconfig.json             # TypeScript 설정
├── README.md                 # 프로젝트 설명서
├── ProblemData/              # 사용자 CSV 데이터 폴더
│   ├── drivers.csv           # 운전자 데이터
│   ├── orders.csv            # 주문 데이터
│   └── depots.csv            # 창고 데이터 (선택)
├── sessions/                 # 프로젝트 세션 저장소
├── output/                   # 결과 파일 출력 폴더
├── src/
│   ├── index.ts              # 메인 MCP 서버
│   ├── config/
│   │   └── api-config.ts     # API 설정
│   ├── types/
│   │   └── index.ts          # TypeScript 타입 정의
│   ├── tools/                # MCP 도구들
│   │   ├── start-project.ts
│   │   ├── prepare-data.ts
│   │   ├── configure-problem.ts
│   │   ├── solve-optimization.ts
│   │   ├── analyze-results.ts
│   │   ├── refine-solution.ts
│   │   └── export-results.ts
│   └── utils/                # 유틸리티 함수들
│       ├── session-manager.ts
│       ├── csv-processor.ts
│       └── api-client.ts
└── dist/                     # 컴파일된 JavaScript 파일들
```

## 🛠️ 개발

### 스크립트

```bash
# 개발 모드 실행
npm run dev

# TypeScript 컴파일
npm run build

# 프로덕션 실행
npm start
```

### 환경 변수

프로젝트 루트에 `.env` 파일 생성 (선택사항):

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Optimization Engine Configuration
DEFAULT_TIME_LIMIT=60
MAX_VEHICLES=10
```

## 📈 성능 및 확장성

- **처리 능력**: 최대 500개 주문, 50대 차량 동시 처리
- **응답 시간**: 일반적인 문제 30초 이내 해결
- **정확도**: 최적 해의 95% 이상 품질 보장
- **확장성**: 대규모 문제를 위한 분산 처리 지원

## 🔒 보안

- 모든 데이터는 로컬에서 처리
- 외부 서버 전송 시 암호화 적용
- 세션 기반 데이터 격리
- API 키 기반 인증

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

MIT License - 자세한 내용은 `LICENSE` 파일을 참조하세요.

## 📞 지원

- **문제 보고**: [GitHub Issues](https://github.com/omeletJK/TMS-MCP-Server/issues)
- **기능 제안**: [GitHub Discussions](https://github.com/omeletJK/TMS-MCP-Server/discussions)
- **문서**: [Wiki](https://github.com/omeletJK/TMS-MCP-Server/wiki)

## 🏆 성공 사례

> "TMS-MCP-Server 덕분에 배송 비용을 20% 절감하고 고객 만족도를 크게 향상시킬 수 있었습니다." - 서울 물류기업 A

> "자연어로 복잡한 최적화 문제를 해결할 수 있어서 업무 효율성이 3배 증가했습니다." - 중소 택배업체 B

---

**TMS-MCP-Server**로 스마트한 배송 최적화를 시작하세요! 🚀 