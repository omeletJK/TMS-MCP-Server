#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { startProjectTool, handleStartProject } from './tools/start-project.js';
import { prepareDataTool, handlePrepareData } from './tools/prepare-data.js';
import { configureProblemTool, handleConfigureProblem } from './tools/configure-problem.js';
import { solveOptimizationTool, handleSolveOptimization } from './tools/solve-optimization.js';
import { analyzeResultsTool, handleAnalyzeResults } from './tools/analyze-results.js';
import { refineSolutionTool, handleRefineSolution } from './tools/refine-solution.js';
import { exportResultsTool, handleExportResults } from './tools/export-results.js';

// Server info
const SERVER_INFO = {
  name: 'tms-mcp-server',
  version: '1.0.0',
  description: 'OMELET 배송 최적화 MCP 서버 - Claude Desktop에서 자연어로 복잡한 배송 최적화 문제를 해결'
};

// Create server instance
const server = new Server(
  SERVER_INFO,
  {
    capabilities: {
      tools: {},
    },
  }
);

// List all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      startProjectTool,
      prepareDataTool,
      configureProblemTool,
      solveOptimizationTool,
      analyzeResultsTool,
      refineSolutionTool,
      exportResultsTool
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'start_project':
        return await handleStartProject(args || {});
      
      case 'prepare_data':
        return await handlePrepareData(args || {});
      
      case 'configure_problem':
        return await handleConfigureProblem(args || {});
      
      case 'solve_optimization':
        return await handleSolveOptimization(args || {});
      
      case 'analyze_results':
        return await handleAnalyzeResults(args || {});
      
      case 'refine_solution':
        return await handleRefineSolution(args || {});
      
      case 'export_results':
        return await handleExportResults(args || {});
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error handling tool ${name}:`, error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **도구 실행 중 오류가 발생했습니다**\n\n` +
              `도구: ${name}\n` +
              `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. 입력 매개변수를 확인해주세요\n` +
              `2. 필수 파일들이 존재하는지 확인해주세요\n` +
              `3. 네트워크 연결을 확인해주세요 (API 호출 시)\n` +
              `4. 다시 시도해보세요`
      }]
    };
  }
});

// Error handling
process.on('SIGINT', async () => {
  console.error('\n🛑 TMS MCP Server를 종료합니다...');
  await server.close();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('처리되지 않은 Promise 거부:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('처리되지 않은 예외:', error);
  process.exit(1);
});

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('🚀 TMS MCP Server가 시작되었습니다!');
    console.error('📊 OMELET 배송 최적화 서버 v1.0.0');
    console.error('🔗 Claude Desktop과 연결 준비 완료');
    console.error('');
    console.error('💡 사용 가능한 도구:');
    console.error('  - start_project: 새 배송 최적화 프로젝트 시작');
    console.error('  - prepare_data: 데이터 준비 및 검증');
    console.error('  - configure_problem: 최적화 문제 설정');
    console.error('  - solve_optimization: 최적화 실행');
    console.error('  - analyze_results: 결과 분석');
    console.error('  - refine_solution: 해결책 개선');
    console.error('  - export_results: 결과 내보내기');
    console.error('');
    console.error('🎯 "새 배송 최적화 프로젝트 시작해줘"라고 말해보세요!');
    
  } catch (error) {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  }
}

// Self-executing main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ 메인 함수 실행 실패:', error);
    process.exit(1);
  });
} 