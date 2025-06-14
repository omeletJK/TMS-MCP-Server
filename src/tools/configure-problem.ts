import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { OptimizationConfig } from '../types/index.js';
import { CSVProcessor } from '../utils/csv-processor.js';
import { OmeletAPIClient } from '../utils/api-client.js';

const sessionManager = new SessionManager();
const csvProcessor = new CSVProcessor();
const apiClient = new OmeletAPIClient();

export const configureProblemTool: Tool = {
  name: 'configure_problem',
  description: `최적화 문제를 설정합니다.

이 도구는 다음과 같은 워크플로우를 제공합니다:
1. 데이터 기반 자동 감지 및 기본 설정 제안
2. 최적화 목표 선택 (비용/시간/거리/고객만족도)
3. 제약 조건 검토 및 사용자 선택적 변경
4. 고급 옵션 구성
5. 설정 요약 및 확정

중요: AI는 절대로 임의로 제약 조건을 변경하지 않으며, 모든 변경은 사용자의 명시적 지시에서만 가능합니다.`,
  
  inputSchema: {
    type: 'object',
    properties: {
      step: {
        type: 'string',
        enum: ['analyze', 'objective', 'constraints', 'distance', 'advanced', 'confirm'],
        description: '설정 단계: analyze(데이터분석), objective(목표선택), constraints(제약변경), distance(거리계산방식), advanced(고급옵션), confirm(확정)',
        default: 'analyze'
      },
      objective: {
        type: 'string',
        enum: ['cost', 'time', 'distance', 'satisfaction'],
        description: '최적화 목표: cost(비용최소화), time(시간단축), distance(거리최소화), satisfaction(고객만족도)'
      },
      constraint_overrides: {
        type: 'object',
        properties: {
          vehicle_capacity: {
            type: 'boolean',
            description: '차량 용량 제약 강제 변경 (데이터 기반 자동 감지를 무시)'
          },
          time_windows: {
            type: 'boolean',
            description: '시간창 제약 강제 변경 (데이터 기반 자동 감지를 무시)'
          },
          working_hours: {
            type: 'boolean',
            description: '근무시간 제약 강제 변경 (데이터 기반 자동 감지를 무시)'
          },
          max_vehicles: {
            type: 'number',
            description: '최대 사용 가능 차량 수 제한'
          }
        }
      },
      distance_type: {
        type: 'string',
        enum: ['euclidean', 'manhattan', 'osrm'],
        description: '거리 계산 방식: euclidean(직선거리), manhattan(맨하탄), osrm(실제도로)',
        default: 'euclidean'
      },
      advanced_options: {
        type: 'object',
        properties: {
          optimization_intensity: {
            type: 'string',
            enum: ['fast', 'balanced', 'thorough'],
            description: '최적화 강도: fast(30초), balanced(60초), thorough(120초)',
            default: 'balanced'
          },
          allow_unassigned: {
            type: 'boolean',
            description: '미할당 주문 허용 여부',
            default: true
          }
        }
      }
    },
    required: []
  }
};

export async function handleConfigureProblem(args: any): Promise<{ content: any[] }> {
  // 세션 ID 검증 제거 - getActiveSession() 사용

  const session = await sessionManager.getActiveSession();
  if (!session) {
    return {
      content: [{
        type: 'text',
        text: `❌ 활성 프로젝트가 없습니다. 먼저 프로젝트를 시작해주세요.`
      }]
    };
  }

  const step = args.step || 'start';

  try {
    switch (step) {
      case 'start':
      case 'analyze':
        return await handleDataAnalysisStep(session);
      
      case 'objective':
        return await handleObjectiveSelectionStep(session, args.objective);
      
      case 'constraints':
        return await handleConstraintConfigurationStep(session, args.constraint_overrides);
      
      case 'distance':
        return await handleDistanceMethodStep(session, args.distance_type);
      
      case 'advanced':
        return await handleAdvancedOptionsStep(session, args.advanced_options);
      
      case 'confirm':
        return await handleConfirmationStep(session);
      
      default:
        return {
          content: [{
            type: 'text',
            text: `❌ 알 수 없는 단계: ${step}. 유효한 단계: start, objective, constraints, distance, advanced, confirm`
          }]
        };
    }
  } catch (error) {
    console.error('Configure problem 오류:', error);
    return {
      content: [{
        type: 'text',
        text: `❌ 설정 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }
}

// 1단계: 데이터 분석 및 기본 설정 자동 감지
async function handleDataAnalysisStep(session: any): Promise<{ content: any[] }> {
  let response = `🔍 **1단계: 데이터 분석 및 자동 감지**\n\n`;
  response += `📋 프로젝트: ${session.name} (ID: ${session.id})\n\n`;

  try {
    // 데이터 로드
    const [drivers, orders, depots] = await Promise.all([
      csvProcessor.readDrivers(),
      csvProcessor.readOrders(),
      csvProcessor.readDepots()
    ]);

    // API 클라이언트를 통한 자동 감지
    const capacityDetected = apiClient.shouldEnableCapacityConstraintFromData(drivers.data, orders.data);
    const timeWindowsDetected = orders.data.some(order => 
      order.time_window_start && order.time_window_end
    );
    const workingHoursDetected = drivers.data.some(driver => 
      driver.working_hours_start || driver.working_hours_end
    );

    // 데이터 통계
    response += `📊 **데이터 현황:**\n`;
    response += `- 운전자: ${drivers.data.length}명\n`;
    response += `- 주문: ${orders.data.length}건\n`;
    response += `- 창고: ${depots.data.length}개\n\n`;

    // 자동 감지 결과
    response += `🤖 **자동 감지된 제약 조건:**\n\n`;
    
    response += `🚛 **차량 용량 제약**: ${capacityDetected ? '✅ 활성화' : '❌ 비활성화'}\n`;
    if (capacityDetected) {
      const capacities = drivers.data.filter(d => Number(d.capacity) > 0).map(d => d.capacity);
      const weights = orders.data.filter(o => Number(o.weight) > 0).map(o => o.weight);
      response += `   - 차량 용량: ${capacities.join(', ')}\n`;
      response += `   - 주문 무게: ${weights.join(', ')}\n`;
    } else {
      response += `   - 이유: 용량/무게 데이터가 모두 0 또는 없음\n`;
    }

    response += `\n⏰ **시간창 제약**: ${timeWindowsDetected ? '✅ 활성화' : '❌ 비활성화'}\n`;
    if (timeWindowsDetected) {
      const timeWindowCount = orders.data.filter(o => o.time_window_start && o.time_window_end).length;
      response += `   - ${timeWindowCount}개 주문에 시간창 설정됨\n`;
    } else {
      response += `   - 이유: 시간창 데이터 없음\n`;
    }

    response += `\n👨‍💼 **근무시간 제약**: ${workingHoursDetected ? '✅ 활성화' : '❌ 비활성화'}\n`;
    if (workingHoursDetected) {
      const workingHoursCount = drivers.data.filter(d => d.working_hours_start || d.working_hours_end).length;
      response += `   - ${workingHoursCount}명 운전자에 근무시간 설정됨\n`;
    } else {
      response += `   - 이유: 근무시간 데이터 없음\n`;
    }

    // 세션에 자동 감지 결과 저장
    session.auto_detected_constraints = {
      vehicle_capacity: capacityDetected,
      time_windows: timeWindowsDetected,
      working_hours: workingHoursDetected,
      detected_at: new Date().toISOString()
    };

    await sessionManager.saveSession(session);

    response += `\n🎯 **다음 단계:**\n`;
    response += `**Option 1:** 목표 선택하기\n`;
    response += `- \`configure_problem\` 도구에 \`step: "objective"\`와 \`objective: "cost|time|distance|satisfaction"\` 전달\n`;
    response += `- 예: "비용 최소화로 목표 설정해줘"\n\n`;
    response += `**Option 2:** 제약 조건 변경하기\n`;
    response += `- \`configure_problem\` 도구에 \`step: "constraints"\`와 원하는 변경사항 전달\n`;
    response += `- 예: "용량 제약을 비활성화해줘"\n\n`;
    response += `⚠️ **중요**: AI는 절대로 임의로 제약 조건을 변경하지 않습니다. 모든 변경은 사용자의 명시적 지시가 필요합니다.`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    response += `❌ **데이터 분석 실패**: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n`;
    response += `🔧 **해결 방법:**\n`;
    response += `1. 데이터 파일이 올바른 형식인지 확인해주세요\n`;
    response += `2. \`prepare_data\` 도구를 다시 실행해보세요`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }
}

// 2단계: 최적화 목표 선택
async function handleObjectiveSelectionStep(session: any, objective?: string): Promise<{ content: any[] }> {
  let response = `🎯 **2단계: 최적화 목표 선택**\n\n`;

  if (!objective) {
    response += `📋 **사용 가능한 최적화 목표:**\n\n`;
    response += `💰 **cost** - 비용 최소화\n`;
    response += `   - 연료비, 인건비, 차량 운영비 등 총 비용 최소화\n`;
    response += `   - 추천: 물류 비용 절감이 주요 목표일 때\n\n`;
    
    response += `⏰ **time** - 시간 단축\n`;
    response += `   - 총 배송 시간 및 대기 시간 최소화\n`;
    response += `   - 추천: 빠른 배송이 경쟁력일 때\n\n`;
    
    response += `📏 **distance** - 거리 최소화\n`;
    response += `   - 총 이동 거리 최소화\n`;
    response += `   - 추천: 환경 친화적 운영이나 차량 마모 최소화\n\n`;
    
    response += `😊 **satisfaction** - 고객 만족도\n`;
    response += `   - 시간창 준수 및 우선순위 배송 최적화\n`;
    response += `   - 추천: 고객 서비스 품질이 우선일 때\n\n`;
    
    response += `💡 **목표를 선택하려면:**\n`;
    response += `\`configure_problem\` 도구에 \`step: "objective"\`와 \`objective\` 값을 전달하세요.\n`;
    response += `예: "비용 최소화로 목표 설정해줘"`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }

  // 목표 설정
  const objectiveLabels = {
    cost: '💰 비용 최소화',
    time: '⏰ 시간 단축',
    distance: '📏 거리 최소화',
    satisfaction: '😊 고객 만족도 향상'
  };

  if (!session.config) {
    session.config = {};
  }

  session.config.objective = objective;
  session.config.objective_label = objectiveLabels[objective as keyof typeof objectiveLabels];
  session.config.set_at = new Date().toISOString();

  await sessionManager.saveSession(session);

  response += `✅ **목표 설정 완료**: ${objectiveLabels[objective as keyof typeof objectiveLabels]}\n\n`;
  
  response += `🎯 **다음 단계:**\n`;
  response += `**Option 1:** 제약 조건 검토 및 변경\n`;
  response += `- \`configure_problem\` 도구에 \`step: "constraints"\` 전달\n`;
  response += `- 예: "제약 조건을 검토해줘"\n\n`;
  response += `**Option 2:** 고급 옵션 설정\n`;
  response += `- \`configure_problem\` 도구에 \`step: "advanced"\` 전달\n`;
  response += `- 예: "고급 옵션을 설정해줘"\n\n`;
  response += `**Option 3:** 설정 확정하고 진행\n`;
  response += `- \`configure_problem\` 도구에 \`step: "confirm"\` 전달`;

  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 3단계: 제약 조건 검토 및 사용자 선택적 변경
async function handleConstraintConfigurationStep(session: any, constraintOverrides?: any): Promise<{ content: any[] }> {
  let response = `⚙️ **3단계: 제약 조건 검토 및 변경**\n\n`;

  const autoDetected = session.auto_detected_constraints || {};
  
  if (!constraintOverrides) {
    // 현재 상태 표시
    response += `🤖 **현재 자동 감지된 제약 조건:**\n\n`;
    response += `🚛 차량 용량 제약: ${autoDetected.vehicle_capacity ? '✅ 활성화' : '❌ 비활성화'}\n`;
    response += `⏰ 시간창 제약: ${autoDetected.time_windows ? '✅ 활성화' : '❌ 비활성화'}\n`;
    response += `👨‍💼 근무시간 제약: ${autoDetected.working_hours ? '✅ 활성화' : '❌ 비활성화'}\n\n`;
    
    response += `🔧 **제약 조건을 변경하고 싶다면:**\n\n`;
    response += `**용량 제약 변경:**\n`;
    response += `- \`constraint_overrides: { "vehicle_capacity": true/false }\`\n`;
    response += `- 예: "용량 제약을 강제로 활성화해줘"\n\n`;
    
    response += `**시간창 제약 변경:**\n`;
    response += `- \`constraint_overrides: { "time_windows": true/false }\`\n`;
    response += `- 예: "시간창 제약을 비활성화해줘"\n\n`;
    
    response += `**근무시간 제약 변경:**\n`;
    response += `- \`constraint_overrides: { "working_hours": true/false }\`\n`;
    response += `- 예: "근무시간 제약을 활성화해줘"\n\n`;
    
    response += `**차량 수 제한:**\n`;
    response += `- \`constraint_overrides: { "max_vehicles": 숫자 }\`\n`;
    response += `- 예: "최대 차량 수를 5대로 제한해줘"\n\n`;
    
    response += `⚠️ **중요**: 변경하지 않으면 자동 감지된 설정이 유지됩니다.\n`;
    response += `💡 **현재 설정으로 진행하려면**: "설정을 확정해줘" 또는 \`step: "confirm"\``;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }

  // 사용자 변경사항 적용
  if (!session.config) {
    session.config = {};
  }

  const finalConstraints = {
    vehicle_capacity: constraintOverrides.vehicle_capacity !== undefined ? 
      constraintOverrides.vehicle_capacity : autoDetected.vehicle_capacity,
    time_windows: constraintOverrides.time_windows !== undefined ? 
      constraintOverrides.time_windows : autoDetected.time_windows,
    working_hours: constraintOverrides.working_hours !== undefined ? 
      constraintOverrides.working_hours : autoDetected.working_hours,
    max_vehicles: constraintOverrides.max_vehicles || null
  };

  session.config.constraints = finalConstraints;
  session.config.constraint_overrides = constraintOverrides;
  session.config.constraints_set_at = new Date().toISOString();

  await sessionManager.saveSession(session);

  response += `✅ **제약 조건 설정 완료**\n\n`;
  response += `📋 **최종 제약 조건:**\n`;
  response += `🚛 차량 용량 제약: ${finalConstraints.vehicle_capacity ? '✅ 활성화' : '❌ 비활성화'}`;
  if (constraintOverrides.vehicle_capacity !== undefined) {
    response += ` (사용자 변경)`;
  }
  response += '\n';
  
  response += `⏰ 시간창 제약: ${finalConstraints.time_windows ? '✅ 활성화' : '❌ 비활성화'}`;
  if (constraintOverrides.time_windows !== undefined) {
    response += ` (사용자 변경)`;
  }
  response += '\n';
  
  response += `👨‍💼 근무시간 제약: ${finalConstraints.working_hours ? '✅ 활성화' : '❌ 비활성화'}`;
  if (constraintOverrides.working_hours !== undefined) {
    response += ` (사용자 변경)`;
  }
  response += '\n';

  if (finalConstraints.max_vehicles) {
    response += `🚐 최대 차량 수: ${finalConstraints.max_vehicles}대\n`;
  }

  response += `\n🎯 **다음 단계:**\n`;
  response += `**Option 1:** 거리 계산 방식 선택\n`;
  response += `- \`step: "distance"\` 전달\n\n`;
  response += `**Option 2:** 고급 옵션 설정\n`;
  response += `- \`step: "advanced"\` 전달\n\n`;
  response += `**Option 3:** 설정 확정하고 진행\n`;
  response += `- \`step: "confirm"\` 전달`;

  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 4단계: 거리 계산 방식 선택
async function handleDistanceMethodStep(session: any, distanceType?: string): Promise<{ content: any[] }> {
  let response = `⚡ **4단계: 거리 계산 방식 선택**\n\n`;

  if (!distanceType) {
    response += `📐 **거리 계산 방식 선택:**\n\n`;
    
    response += `🏃‍‍♂️ **euclidean (기본값, 추천)**\n`;
    response += `   ✅ 직선 거리 계산\n`;
    response += `   ✅ 빠른 연산 속도 (대용량 데이터 처리 가능)\n`;
    response += `   ✅ 안정적인 결과\n`;
    response += `   ❌ 실제 도로와 다를 수 있음\n\n`;
    
    response += `🚗 **osrm (정확한 도로 거리)**\n`;
    response += `   ✅ 실제 도로 네트워크 기반 거리\n`;
    response += `   ✅ 가장 정확한 거리 계산\n`;
    response += `   ✅ 실제 운송비/시간과 일치\n`;
    response += `   ❌ 연산 시간이 오래 걸림 (소규모 데이터 권장)\n`;
    response += `   ❌ 네트워크 의존성\n\n`;
    
    response += `📱 **manhattan (격자형 거리)**\n`;
    response += `   ✅ 도시 내 격자형 도로에 적합\n`;
    response += `   ❌ 일반적인 배송에는 부적합\n\n`;
    
    response += `💡 **선택 가이드:**\n`;
    response += `- 🏃‍♂️ **빠른 최적화가 필요하다면**: euclidean\n`;
    response += `- 🚗 **정확한 거리가 중요하다면**: osrm\n`;
    response += `- 📊 **주문 수가 50개 이상이라면**: euclidean 권장\n`;
    response += `- 🎯 **주문 수가 20개 이하라면**: osrm 고려\n\n`;
    
    response += `🔧 **선택 방법:**\n`;
    response += `"euclidean으로 설정해줘" 또는 "osrm으로 설정해줘"\n\n`;
    response += `**기본값으로 진행**: "기본값으로 진행해줘"`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }

  // 거리 계산 방식 설정
  if (!session.config) {
    session.config = {};
  }

  if (!session.config.advanced_options) {
    session.config.advanced_options = {};
  }

  session.config.advanced_options.distance_type = distanceType;
  session.config.distance_method_set_at = new Date().toISOString();

  await sessionManager.saveSession(session);

  const distanceLabels = {
    euclidean: '🏃‍♂️ 직선 거리 (빠르고 안정적)',
    osrm: '🚗 실제 도로 거리 (정확하지만 느림)',
    manhattan: '📱 맨하탄 거리 (격자형)'
  };

  response += `✅ **거리 계산 방식 설정 완료**\n\n`;
  response += `📐 **선택된 방식:** ${distanceLabels[distanceType as keyof typeof distanceLabels]}\n\n`;
  
  if (distanceType === 'osrm') {
    response += `⚠️ **OSRM 방식 주의사항:**\n`;
    response += `- 최적화 시간이 2-3배 더 걸릴 수 있습니다\n`;
    response += `- 인터넷 연결이 필요합니다\n`;
    response += `- 대용량 데이터(50개 이상 주문)에는 권장하지 않습니다\n\n`;
  }
  
  response += `🎯 **다음 단계:**\n`;
  response += `**Option 1:** 고급 옵션 설정\n`;
  response += `- \`step: "advanced"\` 전달\n\n`;
  response += `**Option 2:** 설정 확정하고 진행\n`;
  response += `- \`step: "confirm"\` 전달`;

  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 5단계: 고급 옵션 설정
async function handleAdvancedOptionsStep(session: any, advancedOptions?: any): Promise<{ content: any[] }> {
  let response = `⚡ **5단계: 고급 옵션 설정**\n\n`;

  if (!advancedOptions) {
    response += `🔧 **사용 가능한 고급 옵션:**\n\n`;
    
    response += `🚀 **최적화 강도** (optimization_intensity):\n`;
    response += `- \`fast\`: 30초, 빠른 결과\n`;
    response += `- \`balanced\`: 60초, 균형잡힌 품질 (기본값)\n`;
    response += `- \`thorough\`: 120초, 최고 품질\n\n`;
    
    response += `📦 **미할당 허용** (allow_unassigned):\n`;
    response += `- \`true\`: 배송 불가능한 주문 허용 (기본값)\n`;
    response += `- \`false\`: 모든 주문 강제 배송\n\n`;
    
    response += `💡 **고급 옵션을 설정하려면:**\n`;
    response += `\`advanced_options\` 객체에 원하는 설정을 전달하세요.\n`;
    response += `예: "정밀 최적화로 설정해줘" → \`{ "optimization_intensity": "thorough" }\`\n\n`;
    response += `**기본값으로 진행하려면**: "설정을 확정해줘"`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }

  // 고급 옵션 설정
  if (!session.config) {
    session.config = {};
  }

  const finalAdvancedOptions = {
    multi_depot: false, // 기본값
    priority_delivery: true, // 기본값
    optimization_intensity: advancedOptions.optimization_intensity || 'balanced',
    allow_unassigned: advancedOptions.allow_unassigned !== undefined ? 
      advancedOptions.allow_unassigned : true
  };

  session.config.advanced_options = finalAdvancedOptions;
  session.config.advanced_options_set_at = new Date().toISOString();

  await sessionManager.saveSession(session);

  response += `✅ **고급 옵션 설정 완료**\n\n`;
  response += `📋 **최종 고급 옵션:**\n`;
  response += `🚀 최적화 강도: ${finalAdvancedOptions.optimization_intensity}\n`;
  response += `📦 미할당 허용: ${finalAdvancedOptions.allow_unassigned ? '✅ 허용' : '❌ 불허'}\n\n`;
  
  response += `🎯 **다음 단계:**\n`;
  response += `**설정 확정하고 진행**: \`step: "confirm"\` 전달`;

  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 6단계: 설정 확정
async function handleConfirmationStep(session: any): Promise<{ content: any[] }> {
  let response = `✅ **6단계: 설정 확정**\n\n`;

  if (!session.config || !session.config.objective) {
    response += `❌ **설정 누락**: 최적화 목표가 설정되지 않았습니다.\n\n`;
    response += `🔧 **해결 방법:**\n`;
    response += `1. \`step: "objective"\`로 목표를 먼저 선택해주세요\n`;
    response += `2. 예: "비용 최소화로 목표 설정해줘"`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }

  // 최종 설정 구성
  const autoDetected = session.auto_detected_constraints || {};
  const finalConfig: OptimizationConfig = {
    objective: session.config.objective,
    constraints: {
      vehicle_capacity: session.config.constraints?.vehicle_capacity !== undefined ? 
        session.config.constraints.vehicle_capacity : autoDetected.vehicle_capacity || false,
      time_windows: session.config.constraints?.time_windows !== undefined ? 
        session.config.constraints.time_windows : autoDetected.time_windows || false,
      working_hours: session.config.constraints?.working_hours !== undefined ? 
        session.config.constraints.working_hours : autoDetected.working_hours || false,
      max_vehicles: session.config.constraints?.max_vehicles || null
    },
    advanced_options: {
      multi_depot: false, // 기본값
      priority_delivery: true, // 기본값
      optimization_intensity: session.config.advanced_options?.optimization_intensity || 'balanced',
      distance_type: session.config.advanced_options?.distance_type || 'euclidean',
      allow_unassigned: session.config.advanced_options?.allow_unassigned !== undefined ? 
        session.config.advanced_options.allow_unassigned : true
    },
    _metadata: {
      auto_detected_constraints: autoDetected,
      user_overrides: session.config.constraint_overrides || {},
      configured_at: new Date().toISOString(),
      ai_constraint_changes_forbidden: true
    }
  };

  // 세션에 최종 설정 저장
  session.config = finalConfig;
  await sessionManager.saveSession(session);
  await sessionManager.completeStep(session.id, 'configure_problem');

  // 설정 요약 생성
  response += generateConfigurationSummary(finalConfig);
  
  response += `\n🎯 **다음 작업:**\n`;
  response += `**Option 1:** 최적화 실행\n`;
  response += `- "최적화를 실행해줘" 또는 \`solve_optimization\` 도구 사용\n\n`;
  response += `**Option 2:** 설정 수정\n`;
  response += `- \`configure_problem\` 도구로 다시 설정 변경\n\n`;
  response += `⚠️ **중요 원칙**: AI는 절대로 이 설정을 임의로 변경하지 않습니다. 모든 변경은 사용자의 명시적 지시에서만 가능합니다.`;

  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 설정 요약 생성
function generateConfigurationSummary(config: OptimizationConfig): string {
  let summary = `📋 **최종 설정 요약:**\n\n`;
  
  // 목표
  const objectiveLabels = {
    cost: '💰 비용 최소화',
    time: '⏰ 시간 단축',
    distance: '📏 거리 최소화',
    satisfaction: '😊 고객 만족도 향상'
  };
  summary += `🎯 **최적화 목표**: ${objectiveLabels[config.objective as keyof typeof objectiveLabels]}\n\n`;
  
  // 제약 조건
  summary += `⚙️ **제약 조건:**\n`;
  summary += `- 🚛 차량 용량 제약: ${config.constraints.vehicle_capacity ? '✅ 활성화' : '❌ 비활성화'}\n`;
  summary += `- ⏰ 시간창 제약: ${config.constraints.time_windows ? '✅ 활성화' : '❌ 비활성화'}\n`;
  summary += `- 👨‍💼 근무시간 제약: ${config.constraints.working_hours ? '✅ 활성화' : '❌ 비활성화'}\n`;
  if (config.constraints.max_vehicles) {
    summary += `- 🚐 최대 차량 수: ${config.constraints.max_vehicles}대\n`;
  }
  
  // 고급 옵션
  summary += `\n⚡ **고급 옵션:**\n`;
  summary += `- 🚀 최적화 강도: ${config.advanced_options.optimization_intensity}\n`;
  summary += `- 📐 거리 계산: ${config.advanced_options.distance_type}\n`;
  summary += `- 📦 미할당 허용: ${config.advanced_options.allow_unassigned ? '✅ 허용' : '❌ 불허'}\n`;
  
  // 메타데이터
  if (config._metadata?.user_overrides && Object.keys(config._metadata.user_overrides).length > 0) {
    summary += `\n🔧 **사용자 변경사항:**\n`;
    Object.entries(config._metadata.user_overrides).forEach(([key, value]) => {
      summary += `- ${key}: ${value}\n`;
    });
  }

  return summary;
} 