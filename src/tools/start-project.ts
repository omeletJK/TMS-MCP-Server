import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { CSVProcessor } from '../utils/csv-processor.js';
import { ProjectSession } from '../types/index.js';

const sessionManager = new SessionManager();
const csvProcessor = new CSVProcessor();

export const startProjectTool: Tool = {
  name: 'start_project',
  description: `새로운 배송 최적화 프로젝트를 시작합니다. 

이 도구는 다음과 같은 작업을 수행합니다:
- 고유한 프로젝트 ID 생성 및 세션 폴더 생성
- 배송 최적화 7단계 워크플로우 가이드 제공
- ProblemData 폴더가 비어있으면 샘플 CSV 자동 생성
- 기본적으로 새 프로젝트를 생성 (기존 프로젝트는 force_new: false로 찾기 가능)
- 다음 단계(prepare_data) 안내`,
  
  inputSchema: {
    type: 'object',
    properties: {
      project_name: {
        type: 'string',
        description: '프로젝트 이름 (선택사항, 없으면 자동 생성)',
      },
      force_new: {
        type: 'boolean',
        description: '기존 프로젝트가 있어도 새로 생성할지 여부 (기본: true)',
        default: true
      }
    }
  }
};

export async function handleStartProject(args: any): Promise<{ content: any[] }> {
  try {
    const { project_name, force_new = true } = args;

    // 1. 기존 프로젝트 확인
    const existingSessions = await sessionManager.listSessions();
    
    if (existingSessions.length > 0 && force_new === false) {
      let response = `🔍 **기존 프로젝트 조회 모드**\n\n`;
      response += `💡 일반적으로는 새 프로젝트를 자동으로 시작하지만, \`force_new: false\` 옵션으로 기존 프로젝트를 찾는 모드입니다.\n\n`;
      
      // 최근 3개 프로젝트 표시
      const recentSessions = existingSessions.slice(0, 3);
      response += `📋 **최근 프로젝트 목록:**\n`;
      
      for (const session of recentSessions) {
        const progress = sessionManager.getProgress(session);
        const nextStep = sessionManager.getNextStep(session);
        
        response += `\n**${session.name}**\n`;
        response += `- ID: \`${session.id}\`\n`;
        response += `- 진행률: ${progress.completed}/${progress.total} 단계 (${progress.percentage}%)\n`;
        response += `- 마지막 업데이트: ${new Date(session.updated_at).toLocaleString('ko-KR')}\n`;
        
        if (nextStep) {
          response += `- 다음 단계: ${nextStep.title}\n`;
        } else {
          response += `- 상태: ✅ 완료\n`;
        }
      }
      
      response += `\n🎯 **다음 액션 선택:**\n`;
      response += `1. **기존 프로젝트 계속하기**: 위 프로젝트 ID로 해당 단계 도구를 실행하세요\n`;
      response += `2. **새 프로젝트 시작**: 다시 \`start_project\`를 실행하세요 (자동으로 새 프로젝트 생성)\n\n`;
      response += `💡 **참고:** 새 대화창에서는 항상 새 프로젝트로 시작됩니다!`;

      return {
        content: [{
          type: 'text',
          text: response
        }]
      };
    }

    // 2. 새 프로젝트 생성
    const newSession = await sessionManager.createSession(project_name);
    
    // 3. 샘플 데이터 확인 및 생성
    const filesExist = await csvProcessor.checkFilesExist();
    let sampleDataMessage = '';
    
    if (!filesExist.all_exist) {
      await csvProcessor.createSampleFiles();
      sampleDataMessage = `\n📁 **샘플 데이터 생성 완료!**\n`;
      sampleDataMessage += `ProblemData 폴더에 다음 파일들이 생성되었습니다:\n`;
      sampleDataMessage += `- drivers.csv (운전자 3명)\n`;
      sampleDataMessage += `- orders.csv (주문 5건)\n`;
      sampleDataMessage += `- depots.csv (창고 1개)\n\n`;
      sampleDataMessage += `💡 이 파일들을 수정하여 실제 데이터로 교체하거나 그대로 사용할 수 있습니다.\n`;
    } else {
      sampleDataMessage = `\n📁 **기존 데이터 파일 발견**\n`;
      sampleDataMessage += `ProblemData 폴더의 기존 파일들을 사용합니다.\n`;
    }

    // 4. 워크플로우 가이드 생성
    const workflowGuide = generateWorkflowGuide();
    
    // 5. 응답 메시지 구성
    let response = `새로운 배송 최적화 프로젝트가 시작되었습니다!\n\n`;
    response += `테스트 메시지: 이 메시지가 보이면 새 코드가 작동하는 것입니다\n\n`;
    
    // 워크플로우 가이드를 가장 먼저 표시 (강제 표시)
    response += `===============================================\n`;
    response += `           7단계 워크플로우 가이드\n`;
    response += `===============================================\n\n`;
    
    response += workflowGuide;
    response += `\n` + `=`.repeat(80) + `\n\n`;
    
    response += `📊 **프로젝트 정보:**\n`;
    response += `- 이름: ${newSession.name}\n`;
    response += `- ID: \`${newSession.id}\`\n`;
    response += `- 생성일: ${new Date(newSession.created_at).toLocaleString('ko-KR')}\n`;
    
    response += sampleDataMessage;
    
    response += `\n✅ **1단계 완료: 프로젝트 시작**\n\n`;
    response += `🤔 **어떻게 진행하시겠습니까?**\n`;
    response += `다음 중 하나를 선택해주세요:\n\n`;
    response += `1. **데이터 검증 진행** - "데이터를 분석하고 문제점을 알려줘"\n`;
    response += `2. **샘플 데이터로 바로 시작** - "샘플 데이터로 테스트해줘"\n`;
    response += `3. **워크플로우 다시 보기** - "7단계 워크플로우를 다시 설명해줘"\n\n`;
    response += `💡 **중요:** 위의 7단계 워크플로우를 숙지하신 후 진행해주세요!`;

    // 6. 세션에 첫 번째 단계 완료 표시
    await sessionManager.completeStep(newSession.id, 'start_project');

    return {
      content: [{
        type: 'text',
        text: `배송 최적화 프로젝트가 시작되었습니다! 새로운 프로젝트를 생성하고 7단계 워크플로우를 설정해드렸습니다.

7단계 워크플로우:
1. 🚀 프로젝트 시작 (완료)
2. 📊 데이터 준비 및 검증
3. ⚙️ 최적화 문제 설정  
4. 🧮 최적화 실행
5. 📈 결과 분석
6. 🔧 해결책 개선
7. 📤 결과 내보내기

ProblemData 폴더에 배송 최적화 문제 구성을 위한 데이터 CSV 파일들을 준비해주세요. 

다음 단계로 진행하시겠습니까?`
      }]
    };

  } catch (error) {
    console.error('Start project error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **프로젝트 시작 중 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 파일 권한을 확인해주세요\n` +
              `2. sessions 및 ProblemData 폴더 생성 권한이 있는지 확인해주세요\n` +
              `3. 다시 시도해보세요`
      }]
    };
  }
}

function generateWorkflowGuide(): string {
  let guide = `\n**TMS 배송 최적화 7단계 워크플로우**\n\n`;
  guide += `목표: 차량 배송 경로를 최적화하여 비용↓, 시간↓, 효율성↑을 달성합니다.\n\n`;
  guide += `중요: 아래 7단계 과정을 반드시 숙지하고 진행하세요!\n\n`;
  
  const steps = [
    { 
      num: 1, 
      name: '🚀 프로젝트 시작', 
      desc: '프로젝트 초기화 및 샘플 데이터 생성', 
      status: '✅',
      details: '• 고유 세션 ID 생성\n   • ProblemData 폴더 확인\n   • 샘플 CSV 파일 자동 생성'
    },
    { 
      num: 2, 
      name: '📊 데이터 준비 및 검증', 
      desc: 'CSV 파일 유효성 검사 및 데이터 정제', 
      status: '⏳',
      details: '• drivers.csv: 운전자 정보 (이름, 용량, 근무시간)\n   • orders.csv: 주문 정보 (위치, 용량, 시간창)\n   • depots.csv: 창고 정보 (출발점)\n   • 데이터 오류 자동 감지 및 수정 제안'
    },
    { 
      num: 3, 
      name: '⚙️ 최적화 문제 설정', 
      desc: '목표 및 제약조건 설정 (용량/시간/근무시간)', 
      status: '⏸️',
      details: '• 최적화 목표: 거리/시간/비용/만족도\n   • 차량 용량 제약 설정\n   • 배송 시간창 제약 설정\n   • 운전자 근무시간 제약 설정'
    },
    { 
      num: 4, 
      name: '🧮 최적화 실행', 
      desc: 'OMELET API 호출하여 실제 경로 최적화', 
      status: '⏸️',
      details: '• 실시간 API 호출 (보통 10-60초 소요)\n   • VRP(차량 라우팅 문제) 해결\n   • 최적 경로 및 차량 배정 계산\n   • 결과 품질 및 실행 가능성 검증'
    },
    { 
      num: 5, 
      name: '📈 결과 분석', 
      desc: '최적화 결과 상세 분석 및 효율성 평가', 
      status: '⏸️',
      details: '• 총 거리/시간/비용 분석\n   • 차량별 경로 및 작업량 분석\n   • 미할당 주문 원인 분석\n   • 효율성 개선 제안'
    },
    { 
      num: 6, 
      name: '🔧 해결책 개선', 
      desc: '피드백 반영하여 최적화 조건 재설정', 
      status: '⏸️',
      details: '• 미할당 주문 해결 방안 제시\n   • 제약조건 완화/강화 옵션\n   • 차량 추가/변경 시나리오 분석\n   • 반복 최적화로 품질 향상'
    },
    { 
      num: 7, 
      name: '📤 결과 내보내기', 
      desc: 'Excel, PDF 등 다양한 형식으로 결과 출력', 
      status: '⏸️',
      details: '• 경로표 Excel 파일 생성\n   • 배송 계획서 PDF 출력\n   • 지도 시각화 이미지\n   • 요약 리포트 및 KPI 대시보드'
    }
  ];

  steps.forEach(step => {
    guide += `${step.status} ${step.num}. ${step.name}\n`;
    guide += `   ${step.desc}\n\n`;
  });

  guide += `예상 총 소요시간: 15-30분\n`;
  guide += `주요 특징: 각 단계는 독립적으로 실행 가능\n\n`;
  
  guide += `시작 가이드:\n`;
  guide += `• 첫 사용자: "샘플 데이터로 테스트해줘"\n`;
  guide += `• 실제 데이터: "데이터 검증해줘"\n`;
  guide += `• 이어서 진행: 기존 프로젝트 ID로 다음 단계 실행\n\n`;

  return guide;
}

// 프로젝트 복구를 위한 헬퍼 함수
export async function listExistingProjects(): Promise<ProjectSession[]> {
  return await sessionManager.listSessions();
}

export async function getProjectSummary(sessionId: string): Promise<string | null> {
  const session = await sessionManager.loadSession(sessionId);
  if (!session) {
    return null;
  }
  
  return sessionManager.generateSessionSummary(session);
} 