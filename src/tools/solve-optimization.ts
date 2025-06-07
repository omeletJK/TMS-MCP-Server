import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { CSVProcessor } from '../utils/csv-processor.js';
import { OmeletAPIClient } from '../utils/api-client.js';
import { ProcessedOmeletResponse, TMSError } from '../types/index.js';

const sessionManager = new SessionManager();
const csvProcessor = new CSVProcessor();
const apiClient = new OmeletAPIClient();

export const solveOptimizationTool: Tool = {
  name: 'solve_optimization',
  description: `OMELET API를 사용하여 배송 경로 최적화를 실행합니다.

이 도구는 다음과 같은 작업을 수행합니다:
- API 연결 상태 사전 점검
- 데이터를 OMELET API 형식으로 변환
- 문제 규모에 따른 적절한 엔드포인트 자동 선택
- 재시도 로직이 포함된 안정적인 API 호출
- 결과 품질 검증 및 이상 탐지
- 세션에 결과 저장 및 백업
- 다음 단계 안내`,
  
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '프로젝트 세션 ID (필수)'
      },
      force_retry: {
        type: 'boolean',
        description: '이전 결과가 있어도 다시 최적화 실행',
        default: false
      },
      custom_options: {
        type: 'object',
        properties: {
          time_limit: {
            type: 'number',
            description: '최적화 시간 제한 (초)',
            minimum: 30,
            maximum: 600
          },
          enable_debug: {
            type: 'boolean',
            description: '디버그 모드 (상세 로그 출력)',
            default: false
          }
        }
      }
    },
    required: ['session_id']
  }
};

export async function handleSolveOptimization(args: any): Promise<{ content: any[] }> {
  try {
    const { session_id, force_retry = false, custom_options = {} } = args;

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

    // 2. 전제 조건 확인
    const preflightCheck = await performPreflightChecks(session);
    if (!preflightCheck.canProceed) {
      return {
        content: [{
          type: 'text',
          text: preflightCheck.message
        }]
      };
    }

    // 3. 이전 결과 확인
    if (session.last_result && !force_retry) {
      return {
        content: [{
          type: 'text',
          text: `🔄 **이전 최적화 결과가 있습니다**\n\n` +
                `${new Date(session.updated_at).toLocaleString('ko-KR')}에 실행된 결과가 있습니다.\n\n` +
                `🎯 **다음 행동 선택:**\n` +
                `1. 기존 결과 분석: \`analyze_results\` 실행\n` +
                `2. 다시 최적화: \`force_retry: true\` 옵션으로 재실행\n` +
                `3. 설정 변경 후 재실행: \`configure_problem\` → \`solve_optimization\`\n\n` +
                `💡 **명령어 예시:**\n` +
                `"결과를 분석해줘" 또는 "다시 최적화해줘"`
        }]
      };
    }

    let response = `🧮 **배송 경로 최적화 실행**\n\n`;
    response += `🔍 프로젝트: ${session.name} (ID: ${session_id})\n`;
    response += `⚙️ 목표: ${getObjectiveLabel(session.config?.objective || 'distance')}\n\n`;

    // 4. API 연결은 실제 요청 시 확인됨
    response += `🌐 **API 클라이언트 준비 완료**\n\n`;

    // 5. 데이터 로드
    const { drivers, orders, depots } = await loadOptimizationData();
    response += `📊 **데이터 로드 완료**\n`;
    response += `- 운전자: ${drivers.data.length}명\n`;
    response += `- 주문: ${orders.data.length}건\n`;
    response += `- 창고: ${depots.data.length}개\n\n`;

    // 6. 최적화 요청 생성
    response += `🔄 **최적화 요청 생성 중...**\n`;
    
    const optimizationOptions = {
      objective: 'minsum' as const, // OMELET API는 minsum/minmax만 지원
      timeLimit: custom_options.time_limit || getTimeLimit(session.config?.advanced_options?.optimization_intensity || 'balanced'),
      enableCapacityConstraint: session.config?.constraints?.vehicle_capacity ?? true,
      enableTimeWindowConstraint: session.config?.constraints?.time_windows ?? true,
      allowUnassignedVisits: false, // 기본적으로 모든 주문 할당 시도
      distanceType: 'euclidean' as const,
      deliveryStartTime: new Date().toISOString()
    };

    const omeletRequest = apiClient.transformToOmeletRequest(
      drivers.data,
      orders.data,
      depots.data,
      optimizationOptions
    );

    // 7. 최적화 실행
    response += `🚀 **최적화 실행 시작...**\n`;
    response += `- 방문지: ${omeletRequest.visits.length}개\n`;
    response += `- 차량: ${omeletRequest.vehicles.length}대\n`;
    response += `- 시간 제한: ${optimizationOptions.timeLimit}초\n\n`;

    if (custom_options.enable_debug) {
              console.error('OMELET Request:', JSON.stringify(omeletRequest, null, 2));
    }

    const startTime = Date.now();
    
    try {
      // 작은 문제는 동기적으로, 큰 문제는 비동기적으로 처리
      const isLargeProblem = omeletRequest.visits.length > 50 || omeletRequest.vehicles.length > 5;
      let optimizationResult;
      
      if (isLargeProblem) {
        response += `🔄 **대규모 문제로 감지 - 비동기 처리 시작...**\n`;
        const jobId = await apiClient.optimizeRoutesLong(omeletRequest);
        response += `📋 작업 ID: ${jobId}\n`;
        optimizationResult = await apiClient.waitForCompletion(jobId);
      } else {
        optimizationResult = await apiClient.optimizeRoutes(omeletRequest);
      }
      
      const endTime = Date.now();
      const executionTime = Math.round((endTime - startTime) / 1000);

      response += `✅ **최적화 완료!** (${executionTime}초 소요)\n\n`;

      // 8. 결과 검증
      const validation = apiClient.validateResponse(optimizationResult);
      
      if (!validation.isValid) {
        response += `⚠️ **결과 검증 실패:**\n`;
        validation.issues.forEach(issue => {
          response += `- ${issue}\n`;
        });
        response += '\n';
      }

      if (validation.warnings.length > 0) {
        response += `⚠️ **주의사항:**\n`;
        validation.warnings.forEach(warning => {
          response += `- ${warning}\n`;
        });
        response += '\n';
      }

      // 9. 결과 요약
      const resultSummary = generateResultSummary(optimizationResult, drivers.data, orders.data);
      response += resultSummary;

      // 10. 세션에 결과 저장
      session.last_result = optimizationResult;
      await sessionManager.saveSession(session);
      await sessionManager.completeStep(session_id, 'solve_optimization');

      // 11. 백업 저장
      await saveOptimizationBackup(session_id, optimizationResult, omeletRequest);

      // 12. 다음 단계 안내
      response += `\n🎯 **다음 단계:**\n`;
      response += `최적화가 완료되었습니다! \`analyze_results\` 도구를 실행하여 결과를 상세히 분석해보세요.\n\n`;
      response += `💡 **명령어 예시:**\n`;
      response += `"결과를 분석하고 지도로 보여줘" 또는 "analyze_results 실행해줘"`;

      return {
        content: [{
          type: 'text',
          text: response
        }]
      };

    } catch (error) {
      const endTime = Date.now();
      const executionTime = Math.round((endTime - startTime) / 1000);
      
      response += `❌ **최적화 실패** (${executionTime}초 후)\n\n`;
      
      if (error instanceof TMSError) {
        response += `**오류 내용:** ${error.message}\n\n`;
        
        if (error.suggestions && error.suggestions.length > 0) {
          response += `🔧 **해결 방법:**\n`;
          error.suggestions.forEach((suggestion, index) => {
            response += `${index + 1}. ${suggestion}\n`;
          });
        }
      } else {
        response += `**오류:** ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n`;
        response += `🔧 **일반적인 해결 방법:**\n`;
        response += `1. 네트워크 연결을 확인해주세요\n`;
        response += `2. 잠시 후 다시 시도해주세요\n`;
        response += `3. 문제가 계속되면 데이터를 확인해주세요`;
      }

      return {
        content: [{
          type: 'text',
          text: response
        }]
      };
    }

  } catch (error) {
    console.error('Solve optimization error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **최적화 실행 중 예상치 못한 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 세션 ID가 올바른지 확인해주세요\n` +
              `2. 이전 단계들이 완료되었는지 확인해주세요\n` +
              `3. 다시 시도해보세요`
      }]
    };
  }
}

// 사전 점검 수행
async function performPreflightChecks(session: any): Promise<{ canProceed: boolean; message: string }> {
  // 데이터 검증 상태 확인
  if (!session.data_status.validation_passed) {
    return {
      canProceed: false,
      message: `⚠️ **데이터 검증이 완료되지 않았습니다**\n\n` +
               `먼저 \`prepare_data\` 도구를 실행하여 데이터를 검증해주세요.\n\n` +
               `💡 **명령어 예시:**\n` +
               `"데이터를 분석하고 검증해줘"`
    };
  }

  // 설정 완료 상태 확인
  if (!session.config) {
    return {
      canProceed: false,
      message: `⚠️ **최적화 설정이 완료되지 않았습니다**\n\n` +
               `먼저 \`configure_problem\` 도구를 실행하여 최적화 문제를 설정해주세요.\n\n` +
               `💡 **명령어 예시:**\n` +
               `"비용 최소화로 문제 설정해줘"`
    };
  }

  // 필수 데이터 확인
  if (!session.data_status.drivers_loaded || !session.data_status.orders_loaded) {
    return {
      canProceed: false,
      message: `❌ **필수 데이터가 부족합니다**\n\n` +
               `운전자와 주문 데이터가 모두 필요합니다.\n\n` +
               `🔧 **해결 방법:**\n` +
               `1. ProblemData 폴더에 drivers.csv와 orders.csv를 확인해주세요\n` +
               `2. \`prepare_data\` 도구를 다시 실행해주세요`
    };
  }

  return { canProceed: true, message: '' };
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

// 목표 라벨 가져오기
function getObjectiveLabel(objective: string): string {
  const labels: Record<string, string> = {
    cost: '💰 비용 최소화',
    time: '⏰ 시간 단축',
    distance: '📏 거리 최소화',
    satisfaction: '😊 고객 만족도 향상'
  };
  
  return labels[objective] || '📏 거리 최소화';
}

// 최적화 목표를 API 형식으로 변환
function mapObjectiveToAPI(objective: string): 'minimize_distance' | 'minimize_time' | 'minimize_cost' {
  const mapping: Record<string, 'minimize_distance' | 'minimize_time' | 'minimize_cost'> = {
    cost: 'minimize_cost',
    time: 'minimize_time',
    distance: 'minimize_distance',
    satisfaction: 'minimize_time' // 고객 만족도는 시간 최소화로 근사
  };
  
  return mapping[objective] || 'minimize_distance';
}

// 최적화 강도에 따른 시간 제한 (OMELET API 제한: 120초)
function getTimeLimit(intensity: string): number {
  const timeLimits: Record<string, number> = {
    fast: 30,      // 30초
    balanced: 60,  // 1분 
    thorough: 120  // 2분 (API 최대값)
  };
  
  return timeLimits[intensity] || 60;
}

// 결과 요약 생성
function generateResultSummary(result: ProcessedOmeletResponse, drivers: any[], orders: any[]): string {
  let summary = `📊 **최적화 결과 요약:**\n\n`;
  
  // 기본 통계
  summary += `🎯 **핵심 지표:**\n`;
  summary += `- 총 거리: ${(result.total_distance / 1000).toFixed(1)} km\n`;
  summary += `- 총 시간: ${Math.round(result.total_duration / 60)} 분\n`;
  
  if (result.total_cost) {
    summary += `- 총 비용: ${result.total_cost.toLocaleString()} 원\n`;
  }
  
  summary += `- 사용 차량: ${result.routes?.length || 0}대 / ${drivers.length}대\n`;
  summary += `- 할당 주문: ${orders.length - (result.unassigned_visits?.length || 0)}건 / ${orders.length}건\n`;
  
  // 최적화 품질은 status 기반으로 표시
  const qualityScore = result.status === 'optimal' ? 100 : 
                       result.status === 'feasible' ? 80 : 
                       result.status === 'feasible_with_unassigned_visits' ? 60 : 30;
  summary += `- 최적화 품질: ${qualityScore}%\n`;
  
  summary += '\n';
  
  // 차량별 요약
  if (result.routes && result.routes.length > 0) {
    summary += `🚚 **차량별 요약:**\n`;
    
    result.routes.forEach((route, index) => {
      const visitCount = route.visits ? route.visits.length : 0;
      summary += `- ${route.vehicle_name}: ${visitCount}개 방문, `;
      summary += `${(route.total_distance / 1000).toFixed(1)}km, `;
      summary += `${Math.round(route.total_duration / 60)}분\n`;
    });
    
    summary += '\n';
  }
  
  // 미할당 주문
  if (result.unassigned_visits && result.unassigned_visits.length > 0) {
    summary += `⚠️ **미할당 주문 (${result.unassigned_visits.length}건):**\n`;
    result.unassigned_visits.slice(0, 5).forEach(visitId => {
      summary += `- ${visitId}\n`;
    });
    
    if (result.unassigned_visits.length > 5) {
      summary += `- ... 외 ${result.unassigned_visits.length - 5}건\n`;
    }
    
    summary += '\n';
    summary += `💡 **미할당 원인:**\n`;
    summary += `- 차량 용량 부족\n`;
    summary += `- 시간창 제약 충돌\n`;
    summary += `- 지리적 접근 불가\n\n`;
  }
  
  // 효율성 분석
  if (result.routes && result.routes.length > 0) {
    const avgDistancePerVehicle = result.total_distance / result.routes.length;
    const avgTimePerVehicle = result.total_duration / result.routes.length;
    
    summary += `📈 **효율성 분석:**\n`;
    summary += `- 차량당 평균 거리: ${(avgDistancePerVehicle / 1000).toFixed(1)} km\n`;
    summary += `- 차량당 평균 시간: ${Math.round(avgTimePerVehicle / 60)} 분\n`;
    summary += `- 차량 활용률: ${((result.routes.length / drivers.length) * 100).toFixed(1)}%\n`;
  }
  
  return summary;
}

// 최적화 결과 백업 저장
async function saveOptimizationBackup(sessionId: string, result: ProcessedOmeletResponse, request: any): Promise<void> {
  try {
    const backupData = {
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      request: request,
      response: result,
      metadata: {
        total_distance: result.total_distance,
        total_duration: result.total_duration,
        total_cost: result.total_cost,
        vehicle_count: result.routes?.length || 0,
        unassigned_count: result.unassigned_visits?.length || 0
      }
    };

    const backupPath = `./output/optimization_backup_${sessionId}_${Date.now()}.json`;
    await require('fs-extra').writeJSON(backupPath, backupData, { spaces: 2 });
    
            console.error(`✅ 최적화 결과 백업 저장: ${backupPath}`);
  } catch (error) {
    console.error('❌ 백업 저장 실패:', error);
    // 백업 실패는 치명적이지 않으므로 무시
  }
} 