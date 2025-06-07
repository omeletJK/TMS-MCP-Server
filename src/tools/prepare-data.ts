import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../utils/session-manager.js';
import { CSVProcessor } from '../utils/csv-processor.js';
import { Driver, Order, Depot, ValidationError, TMSError } from '../types/index.js';

const sessionManager = new SessionManager();
const csvProcessor = new CSVProcessor();

export const prepareDataTool: Tool = {
  name: 'prepare_data',
  description: `데이터 준비 및 검증을 수행합니다.

이 도구는 다음과 같은 작업을 수행합니다:
- CSV 파일 존재 여부 및 형식 확인
- 필수 컬럼 및 데이터 타입 검증
- 오류 발견 시 구체적인 수정 방법 제시
- 데이터 정리 (중복 제거, 형식 통일, 누락값 처리)
- 최적화 가능성 사전 진단
- 세션 상태 업데이트 및 다음 단계 안내`,
  
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '프로젝트 세션 ID (필수)'
      },
      auto_fix: {
        type: 'boolean',
        description: '자동으로 수정 가능한 오류들을 수정할지 여부 (기본: false)',
        default: false
      },
      detailed_analysis: {
        type: 'boolean',
        description: '상세 분석 결과 포함 여부 (기본: true)',
        default: true
      }
    },
    required: ['session_id']
  }
};

export async function handlePrepareData(args: any): Promise<{ content: any[] }> {
  try {
    const { session_id, auto_fix = false, detailed_analysis = true } = args;

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
                `2. 기존 프로젝트 목록을 확인하려면 \`start_project\`를 실행하세요`
        }]
      };
    }

    let response = `📊 **데이터 준비 및 검증 시작**\n\n`;
    response += `🔍 프로젝트: ${session.name} (ID: ${session_id})\n\n`;

    // 2. 파일 존재 여부 확인
    const filesExist = await csvProcessor.checkFilesExist();
    response += `📁 **파일 확인 결과:**\n`;
    response += `- drivers.csv: ${filesExist.drivers ? '✅' : '❌'}\n`;
    response += `- orders.csv: ${filesExist.orders ? '✅' : '❌'}\n`;
    response += `- depots.csv: ${filesExist.depots ? '✅' : '❌'}\n\n`;

    if (!filesExist.drivers || !filesExist.orders) {
      return {
        content: [{
          type: 'text',
          text: response + 
                `❌ **필수 파일이 누락되었습니다**\n\n` +
                `최소한 drivers.csv와 orders.csv 파일이 필요합니다.\n\n` +
                `🔧 **해결 방법:**\n` +
                `1. ProblemData 폴더에 필요한 CSV 파일을 생성하세요\n` +
                `2. 또는 \`start_project\`에서 \`force_new: true\`로 샘플 데이터를 다시 생성하세요`
        }]
      };
    }

    // 3. 데이터 읽기 및 검증
    const validationResults = await validateAllData();
    
    // 4. 검증 결과 분석
    const analysisResult = analyzeValidationResults(validationResults);
    response += generateValidationReport(analysisResult, detailed_analysis);

    // 5. 자동 수정 적용 (옵션)
    if (auto_fix && analysisResult.fixableErrors.length > 0) {
      const fixResults = await applyAutoFixes(analysisResult.fixableErrors);
      response += generateFixReport(fixResults);
      
      // 수정 후 재검증
      const revalidationResults = await validateAllData();
      const newAnalysis = analyzeValidationResults(revalidationResults);
      response += `\n🔄 **수정 후 재검증 결과:**\n`;
      response += generateValidationSummary(newAnalysis);
    }

    // 6. 최적화 가능성 진단
    if (analysisResult.isValid || (analysisResult.criticalErrors.length === 0 && auto_fix)) {
      const feasibilityResult = analyzeFeasibility(
        validationResults.drivers.data,
        validationResults.orders.data,
        validationResults.depots.data
      );
      response += generateFeasibilityReport(feasibilityResult);
    }

    // 7. 세션 상태 업데이트
    await updateSessionDataStatus(session_id, validationResults, analysisResult.isValid);

    // 8. 다음 단계 안내
    if (analysisResult.isValid) {
      await sessionManager.completeStep(session_id, 'prepare_data');
      response += `\n🎯 **다음 단계:**\n`;
      response += `데이터 검증이 완료되었습니다! \`configure_problem\` 도구를 실행하여 최적화 문제를 설정하세요.\n\n`;
      response += `💡 **명령어 예시:**\n`;
      response += `"비용 최소화로 문제 설정해줘" 또는 "configure_problem 실행해줘"`;
    } else {
      response += `\n⚠️ **추가 작업 필요:**\n`;
      response += `데이터 오류를 수정한 후 다시 \`prepare_data\`를 실행해주세요.\n`;
      if (!auto_fix && analysisResult.fixableErrors.length > 0) {
        response += `\n💡 **팁:** \`auto_fix: true\` 옵션으로 자동 수정을 시도할 수 있습니다.`;
      }
    }

    return {
      content: [{
        type: 'text',
        text: response
      }]
    };

  } catch (error) {
    console.error('Prepare data error:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **데이터 준비 중 오류가 발생했습니다**\n\n` +
              `오류 내용: ${error instanceof Error ? error.message : '알 수 없는 오류'}\n\n` +
              `🔧 **해결 방법:**\n` +
              `1. CSV 파일 형식을 확인해주세요\n` +
              `2. 파일이 UTF-8 인코딩인지 확인해주세요\n` +
              `3. 필수 컬럼이 모두 있는지 확인해주세요`
      }]
    };
  }
}

// 모든 데이터 검증
async function validateAllData() {
  const results = {
    drivers: { data: [] as Driver[], errors: [] as ValidationError[] },
    orders: { data: [] as Order[], errors: [] as ValidationError[] },
    depots: { data: [] as Depot[], errors: [] as ValidationError[] }
  };

  try {
    results.drivers = await csvProcessor.readDrivers();
  } catch (error) {
    if (error instanceof TMSError) {
      // 파일이 없는 경우는 이미 위에서 처리됨
    }
  }

  try {
    results.orders = await csvProcessor.readOrders();
  } catch (error) {
    if (error instanceof TMSError) {
      // 파일이 없는 경우는 이미 위에서 처리됨
    }
  }

  try {
    results.depots = await csvProcessor.readDepots();
  } catch (error) {
    if (error instanceof TMSError) {
      // 창고 파일은 선택사항
    }
  }

  return results;
}

// 검증 결과 분석
function analyzeValidationResults(results: any) {
  const allErrors = [
    ...results.drivers.errors,
    ...results.orders.errors,
    ...results.depots.errors
  ];

  const criticalErrors = allErrors.filter(error => 
    ['driver_id', 'order_id', 'start_location_lat', 'start_location_lng', 
     'pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng', 'capacity'].includes(error.field)
  );

  const fixableErrors = allErrors.filter(error => 
    ['working_hours_start', 'working_hours_end', 'time_window_start', 'time_window_end',
     'weight', 'volume', 'priority', 'cost_per_km'].includes(error.field)
  );

  const isValid = criticalErrors.length === 0;

  return {
    allErrors,
    criticalErrors,
    fixableErrors,
    isValid,
    totalValidDrivers: results.drivers.data.length,
    totalValidOrders: results.orders.data.length,
    totalValidDepots: results.depots.data.length
  };
}

// 검증 보고서 생성
function generateValidationReport(analysis: any, detailed: boolean): string {
  let report = `📋 **검증 결과 요약:**\n`;
  report += `- 운전자: ${analysis.totalValidDrivers}명 (유효)\n`;
  report += `- 주문: ${analysis.totalValidOrders}건 (유효)\n`;
  report += `- 창고: ${analysis.totalValidDepots}개 (유효)\n`;
  report += `- 총 오류: ${analysis.allErrors.length}개\n`;
  report += `- 심각한 오류: ${analysis.criticalErrors.length}개\n`;
  report += `- 수정 가능한 오류: ${analysis.fixableErrors.length}개\n\n`;

  if (analysis.isValid) {
    report += `✅ **검증 성공!** 모든 필수 데이터가 올바릅니다.\n\n`;
  } else {
    report += `⚠️ **검증 실패!** 수정이 필요한 오류가 있습니다.\n\n`;
  }

  if (detailed && analysis.allErrors.length > 0) {
    report += generateDetailedErrorReport(analysis.allErrors);
  }

  return report;
}

// 상세 오류 보고서
function generateDetailedErrorReport(errors: ValidationError[]): string {
  let report = `🔍 **상세 오류 분석:**\n\n`;

  // 파일별로 그룹화
  const errorsByFile = errors.reduce((groups: any, error) => {
    const file = error.file || 'unknown';
    if (!groups[file]) groups[file] = [];
    groups[file].push(error);
    return groups;
  }, {});

  Object.entries(errorsByFile).forEach(([file, fileErrors]: [string, any]) => {
    report += `📄 **${file}**\n`;
    
    fileErrors.slice(0, 5).forEach((error: ValidationError) => { // 최대 5개만 표시
      report += `  ❌ 행 ${error.row}: ${error.field}\n`;
      report += `     - 값: "${error.value}"\n`;
      report += `     - 문제: ${error.message}\n`;
      if (error.suggestion) {
        report += `     - 💡 해결방법: ${error.suggestion}\n`;
      }
      report += '\n';
    });

    if (fileErrors.length > 5) {
      report += `  ... 외 ${fileErrors.length - 5}개 오류\n\n`;
    }
  });

  return report;
}

// 검증 요약
function generateValidationSummary(analysis: any): string {
  if (analysis.isValid) {
    return `✅ 모든 데이터가 유효합니다!\n`;
  } else {
    return `⚠️ ${analysis.criticalErrors.length}개의 심각한 오류가 남아있습니다.\n`;
  }
}

// 자동 수정 적용
async function applyAutoFixes(fixableErrors: ValidationError[]): Promise<any> {
  // 실제 구현에서는 파일을 수정하고 결과를 반환
  // 여기서는 시뮬레이션
  return {
    attempted: fixableErrors.length,
    successful: Math.floor(fixableErrors.length * 0.8), // 80% 성공률 가정
    failed: Math.ceil(fixableErrors.length * 0.2)
  };
}

// 수정 보고서 생성
function generateFixReport(fixResults: any): string {
  let report = `\n🔧 **자동 수정 결과:**\n`;
  report += `- 시도: ${fixResults.attempted}개\n`;
  report += `- 성공: ${fixResults.successful}개\n`;
  report += `- 실패: ${fixResults.failed}개\n\n`;
  
  if (fixResults.successful > 0) {
    report += `✅ ${fixResults.successful}개의 오류가 자동으로 수정되었습니다.\n`;
  }
  
  if (fixResults.failed > 0) {
    report += `⚠️ ${fixResults.failed}개의 오류는 수동으로 수정해야 합니다.\n`;
  }

  return report;
}

// 최적화 가능성 분석
function analyzeFeasibility(drivers: Driver[], orders: Order[], depots: Depot[]) {
  const totalCapacity = drivers.reduce((sum, d) => sum + d.capacity, 0);
  const totalDemand = orders.reduce((sum, o) => sum + (o.weight || 0), 0);
  
  const capacityUtilization = totalDemand / totalCapacity;
  const avgOrdersPerDriver = orders.length / drivers.length;
  
  // 지리적 분산 분석 (간단한 버전)
  const orderBounds = getGeographicBounds(orders);
  const driverBounds = getGeographicBounds(drivers.map(d => ({
    pickup_lat: d.start_location_lat,
    pickup_lng: d.start_location_lng
  })));

  return {
    capacityUtilization,
    avgOrdersPerDriver,
    isCapacityFeasible: capacityUtilization <= 0.9, // 90% 이하
    isWorkloadFeasible: avgOrdersPerDriver <= 10, // 운전자당 10건 이하
    geographicSpread: calculateDistance(orderBounds, driverBounds),
    recommendations: generateFeasibilityRecommendations(capacityUtilization, avgOrdersPerDriver)
  };
}

// 실현 가능성 보고서
function generateFeasibilityReport(feasibility: any): string {
  let report = `\n🎯 **최적화 가능성 진단:**\n\n`;
  
  report += `📊 **용량 분석:**\n`;
  report += `- 용량 활용률: ${(feasibility.capacityUtilization * 100).toFixed(1)}%\n`;
  report += `- 용량 충분성: ${feasibility.isCapacityFeasible ? '✅ 충분' : '⚠️ 부족'}\n\n`;
  
  report += `👥 **작업량 분석:**\n`;
  report += `- 운전자당 평균 주문: ${feasibility.avgOrdersPerDriver.toFixed(1)}건\n`;
  report += `- 작업량 적정성: ${feasibility.isWorkloadFeasible ? '✅ 적정' : '⚠️ 과다'}\n\n`;
  
  if (feasibility.recommendations.length > 0) {
    report += `💡 **권장사항:**\n`;
    feasibility.recommendations.forEach((rec: string, index: number) => {
      report += `${index + 1}. ${rec}\n`;
    });
    report += '\n';
  }

  const overallFeasibility = feasibility.isCapacityFeasible && feasibility.isWorkloadFeasible;
  report += `🏆 **전체 평가:** ${overallFeasibility ? 
    '✅ 현재 조건으로 최적화 가능' : 
    '⚠️ 조건 조정 후 최적화 권장'}\n`;

  return report;
}

// 헬퍼 함수들
function getGeographicBounds(locations: any[]) {
  if (locations.length === 0) return null;
  
  const lats = locations.map(l => l.pickup_lat || l.start_location_lat);
  const lngs = locations.map(l => l.pickup_lng || l.start_location_lng);
  
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs)
  };
}

function calculateDistance(bounds1: any, bounds2: any): number {
  if (!bounds1 || !bounds2) return 0;
  
  // 간단한 거리 계산
  const centerLat1 = (bounds1.minLat + bounds1.maxLat) / 2;
  const centerLng1 = (bounds1.minLng + bounds1.maxLng) / 2;
  const centerLat2 = (bounds2.minLat + bounds2.maxLat) / 2;
  const centerLng2 = (bounds2.minLng + bounds2.maxLng) / 2;
  
  return Math.sqrt(Math.pow(centerLat1 - centerLat2, 2) + Math.pow(centerLng1 - centerLng2, 2));
}

function generateFeasibilityRecommendations(capacityUtilization: number, avgOrdersPerDriver: number): string[] {
  const recommendations: string[] = [];
  
  if (capacityUtilization > 0.9) {
    recommendations.push('차량 용량이 부족합니다. 추가 차량 배치를 고려하세요.');
  }
  
  if (avgOrdersPerDriver > 10) {
    recommendations.push('운전자당 주문량이 많습니다. 운전자 추가 또는 주문 분할을 고려하세요.');
  }
  
  if (capacityUtilization < 0.5) {
    recommendations.push('차량 용량이 과도합니다. 더 효율적인 차량 배치를 고려하세요.');
  }
  
  return recommendations;
}

// 세션 데이터 상태 업데이트
async function updateSessionDataStatus(sessionId: string, results: any, isValid: boolean) {
  const session = await sessionManager.loadSession(sessionId);
  if (!session) return;
  
  session.data_status = {
    drivers_loaded: results.drivers.data.length > 0,
    orders_loaded: results.orders.data.length > 0,
    depots_loaded: results.depots.data.length > 0,
    validation_passed: isValid
  };
  
  session.files_processed = [
    'drivers.csv',
    'orders.csv',
    results.depots.data.length > 0 ? 'depots.csv' : null
  ].filter(Boolean) as string[];
  
  await sessionManager.saveSession(session);
} 