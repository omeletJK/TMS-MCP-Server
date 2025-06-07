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
- 기존 프로젝트 목록 조회 및 복구 옵션 제공
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
        description: '기존 프로젝트가 있어도 새로 생성할지 여부 (기본: false)',
        default: false
      }
    }
  }
};

export async function handleStartProject(args: any): Promise<{ content: any[] }> {
  try {
    const { project_name, force_new = false } = args;

    // 1. 기존 프로젝트 확인
    const existingSessions = await sessionManager.listSessions();
    
    if (existingSessions.length > 0 && !force_new) {
      let response = `🔄 **기존 프로젝트가 발견되었습니다!**\n\n`;
      
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
      response += `1. 기존 프로젝트 계속하기: 위 프로젝트 ID로 다음 도구를 실행하세요\n`;
      response += `2. 새 프로젝트 시작: \`force_new: true\` 옵션으로 다시 실행하세요\n\n`;
      response += `💡 **팁:** 중단된 프로젝트는 언제든지 이어서 진행할 수 있습니다!`;

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
    let response = `🚀 **새로운 배송 최적화 프로젝트가 시작되었습니다!**\n\n`;
    response += `📊 **프로젝트 정보:**\n`;
    response += `- 이름: ${newSession.name}\n`;
    response += `- ID: \`${newSession.id}\`\n`;
    response += `- 생성일: ${new Date(newSession.created_at).toLocaleString('ko-KR')}\n`;
    
    response += sampleDataMessage;
    
    response += workflowGuide;
    
    response += `\n🎯 **다음 단계:**\n`;
    response += `\`prepare_data\` 도구를 실행하여 데이터를 확인하고 검증하세요!\n\n`;
    response += `💡 **명령어 예시:**\n`;
    response += `"데이터를 분석하고 문제점을 알려줘" 또는 "prepare_data 실행해줘"`;

    // 6. 세션에 첫 번째 단계 완료 표시
    await sessionManager.completeStep(newSession.id, 'start_project');

    return {
      content: [{
        type: 'text',
        text: response
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
  let guide = `\n📋 **배송 최적화 7단계 워크플로우**\n\n`;
  
  const steps = [
    { num: 1, name: '🚀 프로젝트 시작', desc: '프로젝트 초기화 (완료)', status: '✅' },
    { num: 2, name: '📊 데이터 준비', desc: 'CSV 파일 검증 및 정리', status: '⏳' },
    { num: 3, name: '⚙️ 문제 설정', desc: '목표 및 제약조건 설정', status: '⏸️' },
    { num: 4, name: '🧮 최적화 실행', desc: 'OMELET API로 경로 최적화', status: '⏸️' },
    { num: 5, name: '📈 결과 분석', desc: '최적화 결과 분석 및 시각화', status: '⏸️' },
    { num: 6, name: '🔧 해결책 개선', desc: '피드백 기반 반복 개선', status: '⏸️' },
    { num: 7, name: '📤 결과 내보내기', desc: 'Excel, PDF 등으로 결과 출력', status: '⏸️' }
  ];

  steps.forEach(step => {
    guide += `${step.status} **${step.num}. ${step.name}**\n`;
    guide += `   ${step.desc}\n\n`;
  });

  guide += `⏱️ **예상 총 소요시간:** 15-30분\n`;
  guide += `🔄 **특징:** 각 단계는 독립적으로 실행 가능하며, 언제든 중단 후 재시작할 수 있습니다.\n`;

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