import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { OmeletAPIClient } from '../utils/api-client.js';
import { CSVProcessor } from '../utils/csv-processor.js';

const sessionManager = new SessionManager();
const apiClient = new OmeletAPIClient();
const csvProcessor = new CSVProcessor();

export const refineSolutionTool: Tool = {
  name: 'refine_solution',
  description: `자연어 피드백을 통해 최적화 결과를 개선합니다.

이 도구는 다음과 같은 작업을 수행합니다:
- 자연어 요청 분석 및 최적화 매개변수 조정
- 미할당 주문 해결을 위한 제약조건 완화
- 특정 고객/지역 우선순위 반영
- 비용/시간/거리 균형 조정
- 반복적 개선을 통한 점진적 최적화`,
  
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '프로젝트 세션 ID (필수)'
      },
      feedback: {
        type: 'string',
        description: '개선 요청 내용 (자연어)',
        examples: [
          '미할당 주문을 줄여줘',
          '시간보다 비용을 우선해줘',
          '차량 활용도를 높여줘',
          '특정 고객을 우선 배송해줘'
        ]
      },
      max_iterations: {
        type: 'number',
        description: '최대 개선 반복 횟수',
        default: 3,
        minimum: 1,
        maximum: 5
      },
      preserve_constraints: {
        type: 'boolean',
        description: '기존 제약조건 유지 여부',
        default: false
      }
    },
    required: ['session_id', 'feedback']
  }
};

export async function handleRefineSolution(args: any): Promise<{ content: any[] }> {
  try {
    const { 
      session_id, 
      feedback, 
      max_iterations = 3,
      preserve_constraints = false
    } = args;

    // 1. 세션 로드 및 검증
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

    // 2. 기존 최적화 결과 확인
    if (!session.last_result) {
      return {
        content: [{
          type: 'text',
          text: `⚠️ **개선할 최적화 결과가 없습니다**\n\n` +
                `먼저 \`solve_optimization\` 도구를 실행하여 최적화를 수행해주세요.\n\n` +
                `💡 **명령어 예시:**\n` +
                `"최적화를 실행해줘"`
        }]
      };
    }

    let response = `🔧 **최적화 결과 개선**\n\n`;
    response += `🔍 프로젝트: ${session.name} (ID: ${session_id})\n`;
    response += `💬 요청사항: "${feedback}"\n\n`;

    // 3. 피드백 분석
    const analysisResult = analyzeFeedback(feedback);
    response += `🧠 **요청 분석:**\n`;
    response += `- 주요 목표: ${analysisResult.objective}\n`;
    response += `- 조정 방향: ${analysisResult.adjustment}\n`;
    response += `- 예상 효과: ${analysisResult.expectedImpact}\n\n`;

    // 4. 현재 상태 요약
    const currentState = summarizeCurrentState(session.last_result);
    response += `📊 **현재 상태:**\n`;
    response += currentState;
    response += '\n';

    // 5. 설정 조정
    const adjustedConfig = adjustConfiguration(session.config, analysisResult, preserve_constraints);
    response += `⚙️ **조정된 설정:**\n`;
    response += generateConfigComparison(session.config, adjustedConfig);
    response += '\n';

    // 6. 반복적 개선 실행
    let bestResult = session.last_result;
    let iteration = 0;
    let improvementHistory = [];

    response += `🔄 **개선 과정:**\n`;

    while (iteration < max_iterations) {
      iteration++;
      response += `\n**${iteration}차 시도:**\n`;

      try {
        // 데이터 로드
        const { drivers, orders, depots } = await loadOptimizationData();

        // 최적화 요청 생성
        const omeletRequest = apiClient.transformToOmeletRequest(
          drivers.data,
          orders.data,
          depots.data,
          {
            objective: adjustedConfig.objective,
            timeLimit: 60, // 짧은 시간으로 빠른 반복 (API 제한 준수)
            enableCapacityConstraint: adjustedConfig.constraints.vehicle_capacity,
            enableTimeWindowConstraint: adjustedConfig.constraints.time_windows
          }
        );

        // 최적화 실행
        const newResult = await apiClient.optimizeRoutes(omeletRequest);
        
        // 개선도 평가
        const improvement = evaluateImprovement(bestResult, newResult, analysisResult.objective);
        improvementHistory.push(improvement);

                 response += `- ${improvement.improved ? '✅' : '❌'} ${improvement.metric}: ${improvement.change}\n`;
         // 품질은 status 기반으로 계산
         const qualityScore = newResult.status === 'optimal' ? 100 : 
                              newResult.status === 'feasible' ? 80 : 
                              newResult.status === 'feasible_with_unassigned_visits' ? 60 : 30;
         response += `- 품질: ${qualityScore}%\n`;

        if (improvement.improved) {
          bestResult = newResult;
          response += `- 🎉 새로운 최적 결과로 업데이트!\n`;
        }

        // 수렴 조건 확인
        if (improvement.converged) {
          response += `- 🏁 개선이 수렴했습니다.\n`;
          break;
        }

                 // 다음 반복을 위한 설정 미세조정
         const updatedConfig = finetuneConfig(adjustedConfig, improvement);
         Object.assign(adjustedConfig, updatedConfig);

      } catch (error) {
        response += `- ❌ 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n`;
        break;
      }
    }

    // 7. 최종 결과 저장 및 요약
    if (bestResult !== session.last_result) {
      session.last_result = bestResult;
      session.config = adjustedConfig;
      await sessionManager.saveSession(session);

      response += `\n✅ **개선 완료!**\n\n`;
      response += generateImprovementSummary(session.last_result, bestResult, improvementHistory);
    } else {
      response += `\n💡 **개선 결과:**\n`;
      response += `현재 결과가 이미 최적에 가깝습니다. 추가 개선이 어렵습니다.\n\n`;
      response += generateAlternativeSuggestions(feedback, analysisResult);
    }

    // 8. 다음 작업 선택 옵션 제공
    response += `\n✅ **6단계 완료: 솔루션 개선이 완료되었습니다!**\n\n`;
    response += `🎯 **다음에 무엇을 하시겠습니까?**\n\n`;
    response += `**Option 1:** 🔄 추가 개선\n`;
    response += `- "다른 측면을 개선해줘" 또는 새로운 피드백 제공\n`;
    response += `- 예: "차량별 경로를 더 균등하게 해줘"\n\n`;
    response += `**Option 2:** 📊 개선 효과 분석\n`;
    response += `- "개선 효과를 분석해줘" 또는 "analyze_results 실행"\n`;
    response += `- 개선 전후 비교 및 상세 분석\n\n`;
    response += `**Option 3:** 📋 최종 결과 내보내기\n`;
    response += `- "최종 결과를 내보내줘" 또는 "export_results 실행"\n`;
    response += `- 개선된 결과를 보고서로 저장\n\n`;
    response += `**Option 4:** 🆕 새로운 시나리오\n`;
    response += `- "완전히 다른 조건으로 해줘"\n`;
    response += `- 처음부터 다른 설정으로 재시작\n\n`;
    response += `💬 **어떤 작업을 원하시는지 말씀해주세요!**`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    console.error('Refine solution error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **결과 개선 중 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 피드백 내용을 더 구체적으로 작성해주세요\n` +
              `2. 세션 상태를 확인해주세요\n` +
              `3. 다시 시도해보세요`
      }]
    };
  }
}

// 피드백 분석
function analyzeFeedback(feedback: string): {
  objective: string;
  adjustment: string;
  expectedImpact: string;
} {
  const lowerFeedback = feedback.toLowerCase();
  
  // 키워드 기반 분석
  if (lowerFeedback.includes('미할당') || lowerFeedback.includes('모든') || lowerFeedback.includes('완료')) {
    return {
      objective: '완료율 향상',
      adjustment: '제약조건 완화, 시간 한도 증가',
      expectedImpact: '미할당 주문 감소'
    };
  }
  
  if (lowerFeedback.includes('비용') || lowerFeedback.includes('연료') || lowerFeedback.includes('절약')) {
    return {
      objective: '비용 최소화',
      adjustment: '목표 함수를 비용 중심으로 변경',
      expectedImpact: '총 운송비용 감소'
    };
  }
  
  if (lowerFeedback.includes('시간') || lowerFeedback.includes('빠르') || lowerFeedback.includes('단축')) {
    return {
      objective: '시간 최소화',
      adjustment: '목표 함수를 시간 중심으로 변경',
      expectedImpact: '총 배송시간 단축'
    };
  }
  
  if (lowerFeedback.includes('활용') || lowerFeedback.includes('균등') || lowerFeedback.includes('밸런스')) {
    return {
      objective: '차량 활용도 개선',
      adjustment: '차량별 부하 균등화',
      expectedImpact: '차량 활용률 향상'
    };
  }
  
  if (lowerFeedback.includes('우선') || lowerFeedback.includes('중요')) {
    return {
      objective: '우선순위 반영',
      adjustment: '우선순위 가중치 증가',
      expectedImpact: '중요 주문 우선 처리'
    };
  }
  
  // 기본값
  return {
    objective: '종합 최적화',
    adjustment: '균형잡힌 목표 함수 조정',
    expectedImpact: '전반적 성능 개선'
  };
}

// 현재 상태 요약
function summarizeCurrentState(result: any): string {
  let summary = '';
  summary += `- 총 거리: ${(result.total_distance / 1000).toFixed(1)}km\n`;
  summary += `- 총 시간: ${Math.round(result.total_duration / 60)}분\n`;
  summary += `- 사용 차량: ${result.routes?.length || 0}대\n`;
  summary += `- 완료 주문: ${calculateCompletedOrders(result)}건\n`;
  
  if (result.unassigned_visits?.length > 0) {
    summary += `- 미할당 주문: ${result.unassigned_visits.length}건\n`;
  }
  
  return summary;
}

// 설정 조정
function adjustConfiguration(originalConfig: any, analysis: any, preserveConstraints: boolean): any {
  const adjustedConfig = JSON.parse(JSON.stringify(originalConfig || {}));
  
  // 물리적 제약조건 보호: 불변 제약조건은 절대 변경하지 않음
  const immutableConstraints = originalConfig?._immutable_constraints || {};
  
  // 목표 함수 조정
  switch (analysis.objective) {
    case '완료율 향상':
      // 제약조건 완화로 더 많은 할당 시도
      if (!preserveConstraints) {
        // 물리적 제약조건이 아닌 경우에만 완화 가능
        if (!immutableConstraints.vehicle_capacity) {
          adjustedConfig.constraints.vehicle_capacity = false;
        } else {
          console.warn('🚫 용량 제약조건은 물리적 한계로 인해 비활성화할 수 없습니다.');
          console.warn('🔒 사용자 명시적 허락 없이 이 제약조건을 변경하지 않습니다.');
        }
        
        if (!immutableConstraints.time_windows) {
          adjustedConfig.constraints.time_windows = false;
        }
      }
      adjustedConfig.advanced_options.optimization_intensity = 'thorough';
      break;
      
    case '비용 최소화':
      adjustedConfig.objective = 'cost';
      break;
      
    case '시간 최소화':
      adjustedConfig.objective = 'time';
      break;
      
    case '차량 활용도 개선':
      adjustedConfig.advanced_options.optimization_intensity = 'balanced';
      break;
  }
  
  return adjustedConfig;
}

// 설정 비교 생성
function generateConfigComparison(original: any, adjusted: any): string {
  let comparison = '';
  
  if (original?.objective !== adjusted?.objective) {
    comparison += `- 목표: ${original?.objective || 'distance'} → ${adjusted?.objective}\n`;
  }
  
  if (original?.constraints?.vehicle_capacity !== adjusted?.constraints?.vehicle_capacity) {
    comparison += `- 차량 용량 제약: ${original?.constraints?.vehicle_capacity ? '적용' : '무시'} → ${adjusted?.constraints?.vehicle_capacity ? '적용' : '무시'}\n`;
  }
  
  if (original?.constraints?.time_windows !== adjusted?.constraints?.time_windows) {
    comparison += `- 시간창 제약: ${original?.constraints?.time_windows ? '적용' : '무시'} → ${adjusted?.constraints?.time_windows ? '적용' : '무시'}\n`;
  }
  
  if (original?.advanced_options?.optimization_intensity !== adjusted?.advanced_options?.optimization_intensity) {
    comparison += `- 최적화 강도: ${original?.advanced_options?.optimization_intensity || 'balanced'} → ${adjusted?.advanced_options?.optimization_intensity}\n`;
  }
  
  if (comparison === '') {
    comparison = '- 주요 설정 변경 없음 (미세 조정만 적용)\n';
  }
  
  return comparison;
}

// 데이터 로드
async function loadOptimizationData() {
  const [drivers, orders, depots] = await Promise.all([
    csvProcessor.readDrivers(),
    csvProcessor.readOrders(),
    csvProcessor.readDepots()
  ]);
  
  return { drivers, orders, depots };
}

// 개선도 평가
function evaluateImprovement(oldResult: any, newResult: any, objective: string): any {
  let improved = false;
  let metric = '';
  let change = '';
  let converged = false;
  
  switch (objective) {
    case '완료율 향상':
      const oldCompleted = calculateCompletedOrders(oldResult);
      const newCompleted = calculateCompletedOrders(newResult);
      improved = newCompleted > oldCompleted;
      metric = '완료 주문 수';
      change = `${oldCompleted}건 → ${newCompleted}건`;
      break;
      
    case '비용 최소화':
      const oldCost = oldResult.total_cost || oldResult.total_distance * 0.5;
      const newCost = newResult.total_cost || newResult.total_distance * 0.5;
      improved = newCost < oldCost;
      metric = '총 비용';
      change = `${Math.round(oldCost).toLocaleString()}원 → ${Math.round(newCost).toLocaleString()}원`;
      break;
      
    case '시간 최소화':
      improved = newResult.total_time < oldResult.total_time;
      metric = '총 시간';
      change = `${Math.round(oldResult.total_time / 60)}분 → ${Math.round(newResult.total_time / 60)}분`;
      break;
      
    default:
      improved = newResult.total_distance < oldResult.total_distance;
      metric = '총 거리';
      change = `${(oldResult.total_distance / 1000).toFixed(1)}km → ${(newResult.total_distance / 1000).toFixed(1)}km`;
  }
  
  // 수렴 조건 (개선폭이 5% 미만)
  const oldValue = getMetricValue(oldResult, objective);
  const newValue = getMetricValue(newResult, objective);
  const improvementPercent = Math.abs((newValue - oldValue) / oldValue) * 100;
  converged = improvementPercent < 5;
  
  return {
    improved,
    metric,
    change,
    converged,
    improvementPercent
  };
}

// 설정 미세조정
function finetuneConfig(config: any, improvement: any): any {
  // 개선이 미미한 경우 더 적극적인 조정
  if (improvement.improvementPercent < 2) {
    if (config.advanced_options.optimization_intensity === 'balanced') {
      config.advanced_options.optimization_intensity = 'thorough';
    }
  }
  
  return config;
}

// 개선 요약 생성
function generateImprovementSummary(originalResult: any, finalResult: any, history: any[]): string {
  let summary = `📈 **개선 효과:**\n`;
  
  const distanceImprovement = ((originalResult.total_distance - finalResult.total_distance) / originalResult.total_distance) * 100;
  const timeImprovement = ((originalResult.total_time - finalResult.total_time) / originalResult.total_time) * 100;
  
  summary += `- 거리 개선: ${distanceImprovement.toFixed(1)}% (${((originalResult.total_distance - finalResult.total_distance) / 1000).toFixed(1)}km 단축)\n`;
  summary += `- 시간 개선: ${timeImprovement.toFixed(1)}% (${Math.round((originalResult.total_time - finalResult.total_time) / 60)}분 단축)\n`;
  
  const originalCompleted = calculateCompletedOrders(originalResult);
  const finalCompleted = calculateCompletedOrders(finalResult);
  
  if (finalCompleted > originalCompleted) {
    summary += `- 완료율 개선: ${originalCompleted}건 → ${finalCompleted}건 (+${finalCompleted - originalCompleted}건)\n`;
  }
  
  summary += `- 총 개선 반복: ${history.length}회\n`;
  summary += `- 최종 품질: ${(finalResult.optimization_quality * 100).toFixed(1)}%\n`;
  
  return summary;
}

// 대안 제안 생성
function generateAlternativeSuggestions(feedback: string, analysis: any): string {
  let suggestions = `💡 **대안 제안:**\n\n`;
  
  suggestions += `현재 피드백("${feedback}")으로는 추가 개선이 어렵습니다.\n`;
  suggestions += `다음과 같은 다른 접근을 고려해보세요:\n\n`;
  
  suggestions += `1. **데이터 조정**: 차량 추가, 용량 증가, 시간창 조정\n`;
  suggestions += `2. **다른 목표**: 비용/시간/거리 중 다른 우선순위 설정\n`;
  suggestions += `3. **제약조건 완화**: 일부 제약조건을 임시로 완화\n`;
  suggestions += `4. **분할 배송**: 큰 주문을 여러 번에 나누어 배송\n\n`;
  
  return suggestions;
}

// 헬퍼 함수들
function calculateCompletedOrders(result: any): number {
  return result.routes?.reduce((sum: number, route: any) => sum + (route.visits?.length || 0), 0) || 0;
}

function getMetricValue(result: any, objective: string): number {
  switch (objective) {
    case '완료율 향상':
      return calculateCompletedOrders(result);
    case '비용 최소화':
      return result.total_cost || result.total_distance * 0.5;
    case '시간 최소화':
      return result.total_duration;
    default:
      return result.total_distance;
  }
} 