import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { ProjectSession, WorkflowStep, StepGuide } from '../types/index.js';

// 절대 경로를 사용하여 sessions 디렉토리 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions');
const SESSION_FILE_PREFIX = 'project_';
const ACTIVE_SESSION_FILE = path.join(SESSIONS_DIR, 'active_session.json');

// 워크플로우 단계 가이드
export const WORKFLOW_GUIDES: Record<WorkflowStep, StepGuide> = {
  start_project: {
    step: 'start_project',
    title: '🚀 프로젝트 시작',
    description: '새로운 배송 최적화 프로젝트를 시작하고 작업 환경을 준비합니다.',
    next_step: 'prepare_data',
    estimated_time: '1분'
  },
  prepare_data: {
    step: 'prepare_data',
    title: '📊 데이터 준비',
    description: 'CSV 파일을 검증하고 최적화에 필요한 데이터를 준비합니다.',
    next_step: 'configure_problem',
    required_data: ['drivers.csv', 'orders.csv'],
    estimated_time: '2-3분'
  },
  configure_problem: {
    step: 'configure_problem',
    title: '⚙️ 문제 설정',
    description: '비즈니스 목표와 제약 조건을 설정하여 최적화 문제를 정의합니다.',
    next_step: 'solve_optimization',
    estimated_time: '3-5분'
  },
  solve_optimization: {
    step: 'solve_optimization',
    title: '🧮 최적화 실행',
    description: 'OMELET API를 사용하여 배송 경로 최적화를 수행합니다.',
    next_step: 'analyze_results',
    estimated_time: '30초-5분'
  },
  analyze_results: {
    step: 'analyze_results',
    title: '📈 결과 분석',
    description: '최적화 결과를 분석하고 시각화합니다.',
    next_step: 'refine_solution',
    estimated_time: '2-3분'
  },
  refine_solution: {
    step: 'refine_solution',
    title: '🔧 해결책 개선',
    description: '피드백을 바탕으로 해결책을 반복적으로 개선합니다.',
    next_step: 'export_results',
    estimated_time: '5-10분'
  },
  export_results: {
    step: 'export_results',
    title: '📤 결과 내보내기',
    description: '최종 결과를 Excel, PDF 등으로 내보내어 실제 업무에 활용합니다.',
    estimated_time: '2-3분'
  }
};

export class SessionManager {
  constructor() {
    this.ensureSessionsDir();
  }

  private ensureSessionsDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  // 새 프로젝트 세션 생성
  async createSession(name?: string): Promise<ProjectSession> {
    const session: ProjectSession = {
      id: uuidv4(),
      name: name || `프로젝트_${new Date().toLocaleDateString('ko-KR')}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_step: 0,
      steps_completed: [],
      data_status: {
        drivers_loaded: false,
        orders_loaded: false,
        depots_loaded: false,
        validation_passed: false
      },
      files_processed: []
    };

    await this.saveSession(session);
    await this.setActiveSession(session.id); // 활성 세션으로 설정
    return session;
  }

  // 세션 저장
  async saveSession(session: ProjectSession): Promise<void> {
    session.updated_at = new Date().toISOString();
    const filePath = this.getSessionFilePath(session.id);
    await fs.writeJSON(filePath, session, { spaces: 2 });
  }

  // 세션 로드
  async loadSession(sessionId: string): Promise<ProjectSession | null> {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (!(await fs.pathExists(filePath))) {
        return null;
      }
      return await fs.readJSON(filePath);
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  // 모든 세션 목록 조회
  async listSessions(): Promise<ProjectSession[]> {
    try {
      const files = await fs.readdir(SESSIONS_DIR);
      const sessionFiles = files.filter(f => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'));
      
      const sessions: ProjectSession[] = [];
      for (const file of sessionFiles) {
        try {
          const session = await fs.readJSON(path.join(SESSIONS_DIR, file));
          sessions.push(session);
        } catch (error) {
          console.error(`Failed to read session file ${file}:`, error);
        }
      }

      // 최근 업데이트 순으로 정렬
      return sessions.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  // 세션 삭제
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete session ${sessionId}:`, error);
      return false;
    }
  }

  // 단계 완료 표시
  async completeStep(sessionId: string, step: WorkflowStep): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.steps_completed.includes(step)) {
      session.steps_completed.push(step);
    }

    // 현재 단계 업데이트
    const stepIndex = Object.keys(WORKFLOW_GUIDES).indexOf(step);
    if (stepIndex >= session.current_step) {
      session.current_step = stepIndex + 1;
    }

    await this.saveSession(session);
  }

  // 다음 단계 제안
  getNextStep(session: ProjectSession): StepGuide | null {
    const totalSteps = Object.keys(WORKFLOW_GUIDES).length;
    if (session.current_step >= totalSteps) {
      return null; // 모든 단계 완료
    }

    const nextStepKey = Object.keys(WORKFLOW_GUIDES)[session.current_step] as WorkflowStep;
    return WORKFLOW_GUIDES[nextStepKey];
  }

  // 진행률 계산
  getProgress(session: ProjectSession): { completed: number; total: number; percentage: number } {
    const total = Object.keys(WORKFLOW_GUIDES).length;
    const completed = session.steps_completed.length;
    const percentage = Math.round((completed / total) * 100);

    return { completed, total, percentage };
  }

  // 활성 세션 설정
  async setActiveSession(sessionId: string): Promise<void> {
    try {
      await fs.writeJSON(ACTIVE_SESSION_FILE, { activeSessionId: sessionId });
    } catch (error) {
      console.error('Failed to set active session:', error);
    }
  }

  // 활성 세션 가져오기
  async getActiveSession(): Promise<ProjectSession | null> {
    try {
      if (!(await fs.pathExists(ACTIVE_SESSION_FILE))) {
        return null;
      }
      
      const activeData = await fs.readJSON(ACTIVE_SESSION_FILE);
      const sessionId = activeData.activeSessionId;
      
      if (!sessionId) {
        return null;
      }
      
      return await this.loadSession(sessionId);
    } catch (error) {
      console.error('Failed to get active session:', error);
      return null;
    }
  }

  // 활성 세션 클리어
  async clearActiveSession(): Promise<void> {
    try {
      if (await fs.pathExists(ACTIVE_SESSION_FILE)) {
        await fs.remove(ACTIVE_SESSION_FILE);
      }
    } catch (error) {
      console.error('Failed to clear active session:', error);
    }
  }

  // 세션 파일 경로 생성
  private getSessionFilePath(sessionId: string): string {
    return path.join(SESSIONS_DIR, `${SESSION_FILE_PREFIX}${sessionId}.json`);
  }

  // 세션 유효성 검증
  validateSession(session: ProjectSession): boolean {
    return !!(
      session.id &&
      session.name &&
      session.created_at &&
      session.updated_at &&
      typeof session.current_step === 'number' &&
      Array.isArray(session.steps_completed) &&
      session.data_status &&
      Array.isArray(session.files_processed)
    );
  }

  // 세션 요약 생성
  generateSessionSummary(session: ProjectSession): string {
    const progress = this.getProgress(session);
    const nextStep = this.getNextStep(session);
    
    let summary = `📊 **${session.name}**\n`;
    summary += `🆔 ID: ${session.id}\n`;
    summary += `📅 생성일: ${new Date(session.created_at).toLocaleString('ko-KR')}\n`;
    summary += `🔄 마지막 업데이트: ${new Date(session.updated_at).toLocaleString('ko-KR')}\n`;
    summary += `📈 진행률: ${progress.completed}/${progress.total} 단계 (${progress.percentage}%)\n\n`;

    if (session.data_status.drivers_loaded || session.data_status.orders_loaded) {
      summary += `📁 **데이터 상태:**\n`;
      summary += `- 운전자 데이터: ${session.data_status.drivers_loaded ? '✅' : '❌'}\n`;
      summary += `- 주문 데이터: ${session.data_status.orders_loaded ? '✅' : '❌'}\n`;
      summary += `- 창고 데이터: ${session.data_status.depots_loaded ? '✅' : '❌'}\n`;
      summary += `- 검증 완료: ${session.data_status.validation_passed ? '✅' : '❌'}\n\n`;
    }

    if (nextStep) {
      summary += `🎯 **다음 단계:** ${nextStep.title}\n`;
      summary += `${nextStep.description}\n`;
      if (nextStep.estimated_time) {
        summary += `⏱️ 예상 소요 시간: ${nextStep.estimated_time}\n`;
      }
    } else {
      summary += `🎉 **모든 단계가 완료되었습니다!**\n`;
    }

    return summary;
  }
} 