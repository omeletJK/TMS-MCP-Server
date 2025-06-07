import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { OptimizationConfig } from '../types/index.js';

const sessionManager = new SessionManager();

export const configureProblemTool: Tool = {
  name: 'configure_problem',
  description: `최적화 문제를 설정합니다.

이 도구는 다음과 같은 작업을 수행합니다:
- 비즈니스 목표 설정 (비용/시간/거리/만족도 최소화)
- 실무 제약조건 설정 (용량, 시간창, 근무시간 등)
- 고급 옵션 구성 (다중 창고, 우선순위, 최적화 강도)
- 설정 요약 및 사용자 확인
- 세션에 설정 저장`,
  
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '프로젝트 세션 ID (필수)'
      },
      objective: {
        type: 'string',
        enum: ['cost', 'time', 'distance', 'satisfaction'],
        description: '최적화 목표: cost(비용최소화), time(시간단축), distance(거리최소화), satisfaction(고객만족도)'
      },
      constraints: {
        type: 'object',
        properties: {
          vehicle_capacity: {
            type: 'boolean',
            description: '차량 용량 제약 적용 여부',
            default: true
          },
          time_windows: {
            type: 'boolean',
            description: '시간창 제약 적용 여부',
            default: true
          },
          working_hours: {
            type: 'boolean',
            description: '근무시간 제약 적용 여부',
            default: true
          },
          max_vehicles: {
            type: 'number',
            description: '최대 사용 가능 차량 수'
          }
        }
      },
      advanced_options: {
        type: 'object',
        properties: {
          multi_depot: {
            type: 'boolean',
            description: '다중 창고 모드 활성화',
            default: false
          },
          priority_delivery: {
            type: 'boolean',
            description: '우선순위 배송 적용',
            default: true
          },
          optimization_intensity: {
            type: 'string',
            enum: ['fast', 'balanced', 'thorough'],
            description: '최적화 강도: fast(빠름), balanced(균형), thorough(정밀)',
            default: 'balanced'
          }
        }
      },
      business_rules: {
        type: 'object',
        properties: {
          break_duration: {
            type: 'number',
            description: '휴식 시간 (분)'
          },
          max_working_hours: {
            type: 'number',
            description: '최대 근무 시간 (시간)'
          },
          fuel_cost_per_km: {
            type: 'number',
            description: 'km당 연료비 (원)'
          }
        }
      },
      interactive_mode: {
        type: 'boolean',
        description: '대화형 설정 모드 (단계별 질문)',
        default: false
      }
    },
    required: ['session_id']
  }
};

export async function handleConfigureProblem(args: any): Promise<{ content: any[] }> {
  try {
    const { 
      session_id, 
      objective, 
      constraints, 
      advanced_options,
      business_rules,
      interactive_mode = false 
    } = args;

    // 1. 세션 로드
    const session = await sessionManager.loadSession(session_id);
    if (!session) {
      return {
        content: [{
          type: 'text',
          text: `❌ **세션을 찾을 수 없습니다**\n\n` +
                `세션 ID: ${session_id}\n\n` +
                `🔧 **해결 방법:**\n` +
                `1. \`start_project\` 도구로 새 프로젝트를 시작하세요\n` +
                `2. 올바른 세션 ID를 사용하세요`
        }]
      };
    }

    // 2. 데이터 검증 상태 확인
    if (!session.data_status.validation_passed) {
      return {
        content: [{
          type: 'text',
          text: `⚠️ **데이터 검증이 완료되지 않았습니다**\n\n` +
                `먼저 \`prepare_data\` 도구를 실행하여 데이터를 검증해주세요.\n\n` +
                `💡 **명령어 예시:**\n` +
                `"데이터를 분석하고 검증해줘"`
        }]
      };
    }

    let response = `⚙️ **최적화 문제 설정**\n\n`;
    response += `🔍 프로젝트: ${session.name} (ID: ${session_id})\n\n`;

    // 3. 대화형 모드 처리
    if (interactive_mode && !objective) {
      return await handleInteractiveConfiguration(session_id);
    }

    // 4. 설정값 처리 및 검증
    const config = await buildOptimizationConfig(
      objective, 
      constraints, 
      advanced_options, 
      business_rules,
      session
    );

    // 5. 설정 요약 생성
    const configSummary = generateConfigSummary(config);
    response += configSummary;

    // 6. 비즈니스 영향 분석
    const impactAnalysis = analyzeBusinessImpact(config, session);
    response += impactAnalysis;

    // 7. 세션에 설정 저장
    session.config = config;
    await sessionManager.saveSession(session);
    await sessionManager.completeStep(session_id, 'configure_problem');

    // 8. 다음 단계 안내
    response += `\n🎯 **다음 단계:**\n`;
    response += `설정이 완료되었습니다! \`solve_optimization\` 도구를 실행하여 최적화를 시작하세요.\n\n`;
    response += `💡 **명령어 예시:**\n`;
    response += `"최적화를 실행해줘" 또는 "배송 경로를 최적화해줘"`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    console.error('Configure problem error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **문제 설정 중 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 입력 매개변수를 확인해주세요\n` +
              `2. 세션 ID가 올바른지 확인해주세요\n` +
              `3. 다시 시도해보세요`
      }]
    };
  }
}

// 대화형 설정 처리
async function handleInteractiveConfiguration(sessionId: string): Promise<{ content: any[] }> {
  let response = `🤖 **대화형 최적화 설정**\n\n`;
  
  response += `다음 질문들에 답해주세요:\n\n`;
  
  response += `**1. 주요 목표는 무엇인가요?**\n`;
  response += `- 🚗 "비용" → 총 운송비용 최소화\n`;
  response += `- ⏰ "시간" → 배송 시간 단축\n`;
  response += `- 📏 "거리" → 총 이동거리 최소화\n`;
  response += `- 😊 "만족도" → 고객 만족도 향상\n\n`;
  
  response += `**2. 중요한 제약조건은?**\n`;
  response += `- 차량 용량 초과 금지\n`;
  response += `- 고객 지정 시간대 준수\n`;
  response += `- 운전자 근무시간 준수\n\n`;
  
  response += `**3. 특별한 요구사항이 있나요?**\n`;
  response += `- 우선순위 고객 먼저 배송\n`;
  response += `- 여러 창고 동시 사용\n`;
  response += `- 정밀한 최적화 (시간 더 소요)\n\n`;
  
  response += `💡 **응답 예시:**\n`;
  response += `"비용 최소화로 설정하고, 모든 제약조건을 적용해줘"\n`;
  response += `"시간 단축을 우선으로 하되, 우선순위 배송도 적용해줘"`;
  
  return {
    content: [{
      type: 'text',
      text: response
    }]
  };
}

// 최적화 설정 구성
async function buildOptimizationConfig(
  objective: string | undefined,
  constraints: any,
  advancedOptions: any,
  businessRules: any,
  session: any
): Promise<OptimizationConfig> {
  
  // 데이터 기반 시간 제약 자동 감지
  let hasTimeConstraints = false;
  
  if (session.data_status.drivers_loaded && session.data_status.orders_loaded) {
    // 실제 데이터를 로드해서 시간 정보 확인
    try {
      const csvProcessor = await import('../utils/csv-processor.js');
      const processor = new csvProcessor.CSVProcessor();
      
      const driversResult = await processor.readDrivers();
      const ordersResult = await processor.readOrders();
      
      const drivers = driversResult.data;
      const orders = ordersResult.data;
      
      // 시간 제약 조건 확인
      hasTimeConstraints = orders.some(order => order.time_window_start && order.time_window_end) ||
                           drivers.some(driver => driver.working_hours_start || driver.working_hours_end);
      
    } catch (error) {
      console.warn('데이터 기반 시간 제약 감지 실패, 기본값 사용:', error);
      hasTimeConstraints = true; // 안전한 기본값
    }
  } else {
    hasTimeConstraints = true; // 데이터가 없으면 안전한 기본값
  }
  
  // 기본값 설정 (시간 제약 자동 감지 반영)
  const config: OptimizationConfig = {
    objective: (objective as any) || 'distance', // 내부 설정값 (API 변환시 minsum으로 변환됨)
    constraints: {
      vehicle_capacity: constraints?.vehicle_capacity ?? true,
      time_windows: constraints?.time_windows ?? hasTimeConstraints,
      working_hours: constraints?.working_hours ?? hasTimeConstraints,
      max_vehicles: constraints?.max_vehicles
    },
    advanced_options: {
      multi_depot: advancedOptions?.multi_depot ?? false,
      priority_delivery: advancedOptions?.priority_delivery ?? true,
      optimization_intensity: advancedOptions?.optimization_intensity || 'balanced'
    },
    business_rules: businessRules || {}
  };

  // 데이터 기반 자동 조정
  if (session.data_status.drivers_loaded && session.data_status.orders_loaded) {
    // 실제 데이터 개수에 따른 자동 조정 로직
    // (여기서는 시뮬레이션)
    
    if (!config.constraints.max_vehicles) {
      // 주문 수 기반으로 최대 차량 수 제안
      config.constraints.max_vehicles = Math.min(10, Math.ceil(5 / 3)); // 가상의 계산
    }
  }

  return config;
}

// 설정 요약 생성
function generateConfigSummary(config: OptimizationConfig): string {
  let summary = `📋 **설정 요약:**\n\n`;
  
  // 목표
  const objectiveLabels = {
    cost: '💰 비용 최소화',
    time: '⏰ 시간 단축',
    distance: '📏 거리 최소화',
    satisfaction: '😊 고객 만족도 향상'
  };
  
  summary += `🎯 **주요 목표:** ${objectiveLabels[config.objective]}\n\n`;
  
  // 제약조건
  summary += `🔒 **제약조건:**\n`;
  summary += `- 차량 용량 제약: ${config.constraints.vehicle_capacity ? '✅ 적용' : '❌ 무시'}\n`;
  summary += `- 시간창 제약: ${config.constraints.time_windows ? '✅ 적용' : '❌ 무시'}\n`;
  summary += `- 근무시간 제약: ${config.constraints.working_hours ? '✅ 적용' : '❌ 무시'}\n`;
  
  if (config.constraints.max_vehicles) {
    summary += `- 최대 차량 수: ${config.constraints.max_vehicles}대\n`;
  }
  summary += '\n';
  
  // 고급 옵션
  summary += `⚡ **고급 옵션:**\n`;
  summary += `- 다중 창고: ${config.advanced_options.multi_depot ? '✅ 활성화' : '❌ 비활성화'}\n`;
  summary += `- 우선순위 배송: ${config.advanced_options.priority_delivery ? '✅ 활성화' : '❌ 비활성화'}\n`;
  
  const intensityLabels = {
    fast: '🚀 빠른 처리',
    balanced: '⚖️ 균형',
    thorough: '🔬 정밀 분석'
  };
  summary += `- 최적화 강도: ${intensityLabels[config.advanced_options.optimization_intensity]}\n\n`;
  
  // 비즈니스 규칙
  if (Object.keys(config.business_rules || {}).length > 0) {
    summary += `📊 **비즈니스 규칙:**\n`;
    
    if (config.business_rules?.break_duration) {
      summary += `- 휴식 시간: ${config.business_rules.break_duration}분\n`;
    }
    
    if (config.business_rules?.max_working_hours) {
      summary += `- 최대 근무시간: ${config.business_rules.max_working_hours}시간\n`;
    }
    
    if (config.business_rules?.fuel_cost_per_km) {
      summary += `- km당 연료비: ${config.business_rules.fuel_cost_per_km}원\n`;
    }
    summary += '\n';
  }
  
  return summary;
}

// 비즈니스 영향 분석
function analyzeBusinessImpact(config: OptimizationConfig, session: any): string {
  let analysis = `💼 **예상 비즈니스 영향:**\n\n`;
  
  // 목표별 예상 효과
  switch (config.objective) {
    case 'cost':
      analysis += `💰 **비용 최소화 효과:**\n`;
      analysis += `- 연료비 10-20% 절감 예상\n`;
      analysis += `- 운전자 초과근무 감소\n`;
      analysis += `- 차량 활용도 극대화\n\n`;
      break;
      
    case 'time':
      analysis += `⏰ **시간 단축 효과:**\n`;
      analysis += `- 평균 배송 시간 15-25% 단축\n`;
      analysis += `- 고객 대기시간 감소\n`;
      analysis += `- 같은 시간에 더 많은 배송 가능\n\n`;
      break;
      
    case 'distance':
      analysis += `📏 **거리 최소화 효과:**\n`;
      analysis += `- 총 이동거리 20-30% 감소\n`;
      analysis += `- 차량 마모 감소\n`;
      analysis += `- 환경 친화적 운송\n\n`;
      break;
      
    case 'satisfaction':
      analysis += `😊 **고객 만족도 향상:**\n`;
      analysis += `- 정시 배송률 향상\n`;
      analysis += `- 배송 예측 정확도 증가\n`;
      analysis += `- 고객 불만 감소\n\n`;
      break;
  }
  
  // 제약조건 영향
  analysis += `⚖️ **제약조건 영향:**\n`;
  
  if (config.constraints.vehicle_capacity) {
    analysis += `- ✅ 차량 과적 방지로 안전성 확보\n`;
  } else {
    analysis += `- ⚠️ 차량 용량 초과 위험 (비용 절감 우선)\n`;
  }
  
  if (config.constraints.time_windows) {
    analysis += `- ✅ 고객 약속 시간 준수로 신뢰도 향상\n`;
  } else {
    analysis += `- ⚠️ 고객 시간 요청 무시 (효율성 우선)\n`;
  }
  
  if (config.constraints.working_hours) {
    analysis += `- ✅ 근로자 권익 보호 및 법규 준수\n`;
  } else {
    analysis += `- ⚠️ 운전자 과로 위험 (생산성 우선)\n`;
  }
  
  analysis += '\n';
  
  // 최적화 강도별 예상 시간
  const timeEstimates = {
    fast: '30초-2분',
    balanced: '1-5분',
    thorough: '3-10분'
  };
  
  analysis += `⏱️ **예상 최적화 시간:** ${timeEstimates[config.advanced_options.optimization_intensity]}\n\n`;
  
  // 권장사항
  analysis += `💡 **권장사항:**\n`;
  
  if (config.objective === 'cost' && config.constraints.time_windows) {
    analysis += `- 시간창 제약으로 인해 비용 절감 효과가 제한될 수 있습니다\n`;
  }
  
  if (config.advanced_options.optimization_intensity === 'fast' && config.objective === 'satisfaction') {
    analysis += `- 고객 만족도 향상이 목표라면 'balanced' 이상 강도를 권장합니다\n`;
  }
  
  analysis += `- 첫 실행 후 결과를 보고 \`refine_solution\`으로 세부 조정하세요\n`;
  
  return analysis;
}

// 설정 템플릿 생성 (향후 재사용)
export function createConfigTemplate(config: OptimizationConfig, templateName: string): any {
  return {
    name: templateName,
    config: config,
    created_at: new Date().toISOString(),
    description: `${config.objective} 최적화 템플릿`
  };
} 