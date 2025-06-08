import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { ProcessedOmeletResponse } from '../types/index.js';

const sessionManager = new SessionManager();

export const analyzeResultsTool: Tool = {
  name: 'analyze_results',
  description: `최적화 결과를 상세히 분석하고 시각화합니다.

이 도구는 다음과 같은 작업을 수행합니다:
- 최적화 결과 종합 분석 (거리, 시간, 비용, 효율성)
- 차량별 상세 경로 분석
- 미할당 주문 원인 분석 및 해결책 제안
- 개선 제안 및 다음 단계 가이드`,
  
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '프로젝트 세션 ID (필수)'
      },
      analysis_type: {
        type: 'string',
        enum: ['comprehensive', 'efficiency', 'routes', 'unassigned', 'costs'],
        description: '분석 유형 선택',
        default: 'comprehensive'
      },
      include_visualization: {
        type: 'boolean',
        description: '지도 시각화 데이터 포함 여부',
        default: true
      }
    },
    required: ['session_id']
  }
};

export async function handleAnalyzeResults(args: any): Promise<{ content: any[] }> {
  try {
    const { session_id, analysis_type = 'comprehensive', include_visualization = true } = args;

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

    // 2. 최적화 결과 확인
    if (!session.last_result) {
      return {
        content: [{
          type: 'text',
          text: `⚠️ **분석할 최적화 결과가 없습니다**\n\n` +
                `먼저 \`solve_optimization\` 도구를 실행하여 최적화를 수행해주세요.\n\n` +
                `💡 **명령어 예시:**\n` +
                `"최적화를 실행해줘"`
        }]
      };
    }

    let response = `📊 **최적화 결과 분석**\n\n`;
    response += `🔍 프로젝트: ${session.name} (ID: ${session_id})\n`;
    response += `📅 분석 시점: ${new Date().toLocaleString('ko-KR')}\n\n`;

    const result = session.last_result as ProcessedOmeletResponse;

    // 3. 분석 수행
    response += generateAnalysis(result, analysis_type);

    // 4. 시각화 데이터
    if (include_visualization) {
      response += generateVisualizationData(result);
    }

    // 5. 개선 제안
    response += generateImprovementSuggestions(result);

    // 6. 세션 업데이트
    await sessionManager.completeStep(session_id, 'analyze_results');

    // 7. 다음 작업 선택 옵션 제공
    response += `\n✅ **5단계 완료: 결과 분석이 완료되었습니다!**\n\n`;
    response += `🎯 **다음에 무엇을 하시겠습니까?**\n\n`;
    response += `**Option 1:** 🔧 솔루션 개선\n`;
    response += `- "솔루션을 개선해줘" 또는 "refine_solution 실행"\n`;
    response += `- 자연어로 개선 요청 (예: "미할당 주문을 줄여줘")\n\n`;
    response += `**Option 2:** 📋 결과 내보내기\n`;
    response += `- "결과를 내보내줘" 또는 "export_results 실행"\n`;
    response += `- Excel, PDF, CSV 등 다양한 형식으로 저장\n\n`;
    response += `**Option 3:** 🎨 시각화 강화\n`;
    response += `- "지도를 더 자세히 보여줘" 또는 "차트를 만들어줘"\n`;
    response += `- 추가적인 분석 차트와 지도 생성\n\n`;
    response += `**Option 4:** 🔄 새로운 시나리오\n`;
    response += `- "설정을 바꿔서 다시 최적화해줘"\n`;
    response += `- 다른 조건으로 최적화를 재실행\n\n`;
    response += `💬 **어떤 작업을 원하시는지 말씀해주세요!**`;

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    console.error('Analyze results error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **결과 분석 중 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 세션 ID가 올바른지 확인해주세요\n` +
              `2. 최적화가 완료되었는지 확인해주세요\n` +
              `3. 다시 시도해보세요`
      }]
    };
  }
}

function generateAnalysis(result: ProcessedOmeletResponse, type: string): string {
  let analysis = `📋 **분석 결과 (${type})**\n\n`;

  // 핵심 지표
  analysis += `🎯 **핵심 성과 지표:**\n`;
  analysis += `- 총 이동거리: ${(result.total_distance / 1000).toFixed(1)} km\n`;
  analysis += `- 총 소요시간: ${formatTime(result.total_duration)}\n`;
  
  if (result.total_cost) {
    analysis += `- 총 예상비용: ${result.total_cost.toLocaleString()} 원\n`;
  }
  
  const completionRate = calculateCompletionRate(result);
  analysis += `- 주문 완료율: ${completionRate.toFixed(1)}%\n`;
  
  // 최적화 품질은 status 기반으로 계산
  const qualityScore = result.status === 'optimal' ? 100 : 
                       result.status === 'feasible' ? 80 : 
                       result.status === 'feasible_with_unassigned_visits' ? 60 : 30;
  analysis += `- 최적화 품질: ${qualityScore}%\n`;
  
  analysis += '\n';

  // 차량별 요약
  if (result.routes && result.routes.length > 0) {
    analysis += `🚚 **차량별 요약:**\n`;
    result.routes.forEach((route, index) => {
      const visitCount = route.visits ? route.visits.length : 0;
      analysis += `- ${route.vehicle_name}: ${visitCount}개 방문, `;
      analysis += `${(route.total_distance / 1000).toFixed(1)}km, `;
      analysis += `${Math.round(route.total_duration / 60)}분\n`;
    });
    analysis += '\n';
  }

  // 미할당 주문
  if (result.unassigned_visits && result.unassigned_visits.length > 0) {
    analysis += `⚠️ **미할당 주문 (${result.unassigned_visits.length}건):**\n`;
    result.unassigned_visits.slice(0, 5).forEach(visitId => {
      analysis += `- ${visitId}\n`;
    });
    
    if (result.unassigned_visits.length > 5) {
      analysis += `- ... 외 ${result.unassigned_visits.length - 5}건\n`;
    }
    
    analysis += '\n';
    analysis += `💡 **미할당 원인:**\n`;
    analysis += `- 차량 용량 부족\n`;
    analysis += `- 시간창 제약 충돌\n`;
    analysis += `- 지리적 접근 불가\n\n`;
  }

  return analysis;
}

function generateVisualizationData(result: ProcessedOmeletResponse): string {
  let visualization = `🗺️ **지도 시각화 가이드**\n\n`;

  visualization += `📍 **지도 중심점:** 서울시 중구 (위도 37.5665, 경도 126.9780)\n\n`;

  // 경로별 색상 코드
  visualization += `🎨 **경로별 색상 코드:**\n`;
  const colors = ['🔴 빨강', '🔵 파랑', '🟢 초록', '🟡 노랑', '🟣 보라'];
  
  if (result.routes) {
    result.routes.forEach((route, index) => {
      const color = colors[index % colors.length];
      visualization += `- ${route.vehicle_name}: ${color}\n`;
    });
  }
  
  visualization += '\n';

  visualization += `💡 **시각화 방법:**\n`;
  visualization += `1. Google My Maps에서 새 지도 생성\n`;
  visualization += `2. 각 경로를 레이어로 분리하여 표시\n`;
  visualization += `3. 방문 순서에 따라 번호 마커 추가\n`;
  visualization += `4. 경로별로 다른 색상 적용\n\n`;

  return visualization;
}

function generateImprovementSuggestions(result: ProcessedOmeletResponse): string {
  let suggestions = `💡 **개선 제안**\n\n`;

  const issues = [];
  
  if (result.unassigned_visits && result.unassigned_visits.length > 0) {
    issues.push({
      title: '미할당 주문 해결',
      solution: '차량 추가 또는 제약조건 완화',
      impact: '완료율 100% 달성'
    });
  }
  
  if (result.routes && result.routes.length < 3) {
    issues.push({
      title: '차량 활용도 개선',
      solution: '주문량 증가 또는 차량 수 조정',
      impact: '비용 효율성 10-15% 향상'
    });
  }
  
  if (issues.length === 0) {
    suggestions += `✅ 현재 결과가 매우 우수합니다! 추가 최적화 여지가 제한적입니다.\n\n`;
    return suggestions;
  }

  suggestions += `🎯 **우선순위별 개선 항목:**\n\n`;

  issues.forEach((issue, index) => {
    suggestions += `**${index + 1}. ${issue.title}**\n`;
    suggestions += `- 개선 방법: ${issue.solution}\n`;
    suggestions += `- 예상 효과: ${issue.impact}\n\n`;
  });

  suggestions += `🚀 **즉시 실행 가능한 액션:**\n`;
  suggestions += `1. \`refine_solution\` 도구로 "미할당 주문 줄여줘" 요청\n`;
  suggestions += `2. \`export_results\` 도구로 상세 보고서 생성\n`;
  suggestions += `3. 설정 조정 후 재최적화 실행\n\n`;

  return suggestions;
}

// 헬퍼 함수들
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}시간 ${minutes}분`;
}

function calculateCompletionRate(result: ProcessedOmeletResponse): number {
  const totalOrders = (result.routes?.reduce((sum, route) => sum + (route.visits?.length || 0), 0) || 0) + (result.unassigned_visits?.length || 0);
  const completedOrders = result.routes?.reduce((sum, route) => sum + (route.visits?.length || 0), 0) || 0;
  return totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
} 