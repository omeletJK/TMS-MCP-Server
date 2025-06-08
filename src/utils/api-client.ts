import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  Driver, 
  Order, 
  Depot,
  TMSError,
  OmeletRequest,
  OmeletResponse,
  ProcessedOmeletResponse,
  OmeletRoute,
  LongApiOutput,
  CheckRoutingEngineOutput
} from '../types/index.js';

/**
 * OMELET API v2 응답을 내부 형식으로 변환
 */
function transformOmeletResponse(response: OmeletResponse): ProcessedOmeletResponse {
  const result = response.routing_engine_result;
  
  // 경로 정보 변환
  const routes: OmeletRoute[] = result.routes.map(route => {
    // depot을 제외한 실제 방문지만 추출 (첫 번째와 마지막은 depot)
    const visits = route.route_name.slice(1, -1).map(visitName => ({
      visit_name: visitName,
      arrival_time: undefined, // 실제 API에서는 시간 정보가 없음
      departure_time: undefined
    }));

    return {
      vehicle_name: route.vehicle_name,
      visits,
      total_distance: route.route_cost_details.distance_cost,
      total_duration: route.route_cost_details.duration_cost,
      total_cost: route.route_cost_details.objective_cost
    };
  });

  return {
    status: response.status,
    routes,
    unassigned_visits: result.unassigned_visit_names,
    total_distance: result.solution_cost_details.total_distance_cost,
    total_duration: result.solution_cost_details.total_duration_cost,
    total_cost: result.solution_cost_details.total_objective_cost,
    detail: response.detail
  };
}

export class OmeletAPIClient {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://routing.oaasis.cc';
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OMELET_API_KEY || 'gEL1WT7K7DA4HuhjZ7DnJGFkVtDNTDBoZouhHepaHrw';
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 120000, // 120초로 타임아웃 증가 (OMELET API 최대 시간 제한에 맞춤)
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.omelet.v2+json',
        'X-API-KEY': this.apiKey
      }
    });

    // 요청 인터셉터
    this.client.interceptors.request.use(
      (config) => {
        console.error(`🌐 OMELET API v2 요청: ${config.method?.toUpperCase()} ${config.url}`);
        console.error(`📦 요청 크기: ${JSON.stringify(config.data || {}).length} bytes`);
        return config;
      },
      (error) => {
        console.error('❌ API 요청 오류:', error);
        return Promise.reject(error);
      }
    );

    // 응답 인터셉터
    this.client.interceptors.response.use(
      (response) => {
        console.error(`✅ OMELET API v2 응답: ${response.status} ${response.statusText}`);
        return response;
      },
      (error) => {
        if (error.response) {
          // 서버 응답이 있는 경우
          console.error('❌ API 응답 오류:', error.response.status, error.response.statusText);
          console.error('📄 오류 세부사항:', error.response.data);
        } else if (error.request) {
          // 요청은 보냈지만 응답이 없는 경우
          console.error('❌ 네트워크 오류: 서버에서 응답이 없습니다');
          console.error('📡 요청 정보:', error.request);
        } else {
          // 요청 설정 중 오류
          console.error('❌ 요청 설정 오류:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  // VRP 최적화 요청 (단일 요청) - v2 형식으로 업데이트
  async optimizeRoutes(request: OmeletRequest): Promise<ProcessedOmeletResponse> {
    try {
      console.error(`🧮 VRP 최적화 요청 - 주문: ${request.visits.length}개, 차량: ${request.vehicles.length}대`);

      const response: AxiosResponse<OmeletResponse> = await this.client.post('/api/vrp', request);
      
      if (response.data.status === 'infeasible') {
        throw new TMSError(
          `최적화 실패: ${response.data.detail || '해결 가능한 경로를 찾을 수 없습니다'}`,
          'OPTIMIZATION_FAILED',
          response.data,
          [
            '차량 용량을 늘려보세요',
            '작업 시간을 늘려보세요', 
            '일부 주문을 제외하고 다시 시도해보세요',
            'allow_unassigned_visits 옵션을 활성화해보세요'
          ]
        );
      }

      return transformOmeletResponse(response.data);

    } catch (error) {
      return this.handleApiError(error);
    }
  }

  // VRP 긴 작업 요청 (비동기)
  async optimizeRoutesLong(request: OmeletRequest): Promise<string> {
    try {
      console.error(`🧮 VRP 긴 작업 요청 - 주문: ${request.visits.length}개, 차량: ${request.vehicles.length}대`);

      const response: AxiosResponse<LongApiOutput> = await this.client.post('/api/vrp-long', request);
      
      if (response.status !== 201) {
        throw new TMSError(
          '긴 작업 요청 실패',
          'LONG_REQUEST_FAILED',
          response.data
        );
      }

      console.error(`📋 작업 ID 생성: ${response.data.job_id}`);
      return response.data.job_id;

    } catch (error) {
      return this.handleApiError(error);
    }
  }

  // 작업 결과 확인
  async checkResult(jobId: string): Promise<CheckRoutingEngineOutput> {
    try {
      console.error(`🔍 작업 결과 확인: ${jobId}`);

      const response: AxiosResponse<CheckRoutingEngineOutput> = await this.client.get(`/api/check-result/${jobId}`);
      
      return response.data;

    } catch (error) {
      return this.handleApiError(error);
    }
  }

  // 작업 완료 대기 (폴링) - v2 형식으로 업데이트
  async waitForCompletion(jobId: string, maxWaitTime: number = 300000): Promise<ProcessedOmeletResponse> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5초마다 확인

    console.error(`⏳ 작업 완료 대기 중... (최대 ${maxWaitTime/1000}초)`);

    while (Date.now() - startTime < maxWaitTime) {
      const result = await this.checkResult(jobId);
      
      switch (result.status) {
        case 'completed':
          if (result.result) {
            console.error(`✅ 작업 완료! (${(Date.now() - startTime)/1000}초 소요)`);
            return transformOmeletResponse(result.result);
          } else {
            throw new TMSError('작업이 완료되었지만 결과가 없습니다', 'NO_RESULT');
          }
        
        case 'failed':
          throw new TMSError(
            `작업 실패: ${result.message || '알 수 없는 오류'}`,
            'JOB_FAILED',
            result
          );
        
        case 'processing':
          console.error(`🔄 처리 중... (${(Date.now() - startTime)/1000}초 경과)`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          break;
        
        default:
          throw new TMSError(`알 수 없는 작업 상태: ${result.status}`, 'UNKNOWN_STATUS');
      }
    }

    throw new TMSError(
      `작업 타임아웃 (${maxWaitTime/1000}초 초과)`,
      'TIMEOUT',
      { jobId }
    );
  }

  // 사용자 제공 로직 기반: 원본 CSV 데이터에서 용량 제약 필요성 감지
  shouldEnableCapacityConstraintFromData(drivers: Driver[], orders: Order[]): boolean {
    // 룰 1: Order에 용량 정보가 있는지 확인
    const hasOrderVolume = orders.some(order => 
      (Number(order.volume) || 0) > 0 || (Number(order.weight) || 0) > 0
    );
    
    // 룰 2: Driver에 용량 정보가 있는지 확인
    const hasDriverCapacity = drivers.some(driver =>
      (Number(driver.volume_capacity) || 0) > 0 || (Number(driver.capacity) || 0) > 0
    );
    
    // 둘 중 하나라도 있으면 TRUE
    const result = hasOrderVolume || hasDriverCapacity;
    
    console.error(`🔍 원본 데이터 기반 용량 제약 감지: order_volume=${hasOrderVolume}, driver_capacity=${hasDriverCapacity} => ${result}`);
    
    return result;
  }

  // 데이터를 OMELET API v2 형식으로 변환 (케이스별 최적화)
  transformToOmeletRequest(
    drivers: Driver[], 
    orders: Order[], 
    depots: Depot[],
    options?: {
      objective?: 'minsum' | 'minmax';
      timeLimit?: number;
      enableCapacityConstraint?: boolean;
      enableTimeWindowConstraint?: boolean;
      allowUnassignedVisits?: boolean;
      distanceType?: 'manhattan' | 'euclidean' | 'osrm';
      deliveryStartTime?: string;
    }
    ): OmeletRequest {
    
    // 1. 원본 데이터 기반 용량 제약 감지
    const capacityConstraintFromData = this.shouldEnableCapacityConstraintFromData(drivers, orders);
    
    // 2. 최종 용량 제약 결정 (사용자 명시 옵션 우선, 없으면 데이터 기반 감지)
    let finalCapacityConstraint = capacityConstraintFromData;
    if (options?.enableCapacityConstraint !== undefined) {
      finalCapacityConstraint = options.enableCapacityConstraint;
      console.error(`🎯 사용자 명시 용량 제약: ${finalCapacityConstraint} (데이터 기반: ${capacityConstraintFromData})`);
    }
    
    // 3. 최종 옵션으로 문제 유형 분석 (기존 로직과 결합)
    const optionsWithCapacity = {
      ...options,
      enableCapacityConstraint: finalCapacityConstraint
    };
    
    // 4. 문제 유형 자동 감지
    const problemAnalysis = this.analyzeProblemType(drivers, orders, depots, optionsWithCapacity);
    console.error(`🎯 감지된 문제 유형: ${problemAnalysis.type} (복잡도: ${problemAnalysis.complexity})`);
    
    // 5. Depot 설정 (주소 정보 포함)
    const depot = this.buildDepot(depots, drivers);
    
    // 6. Visits 변환 (케이스별 특성 반영)
    const visits = this.buildVisits(orders, problemAnalysis);
    
    // 7. Vehicles 변환 (케이스별 특성 반영)  
    const vehicles = this.buildVehicles(drivers, problemAnalysis);
    
    // 8. API 옵션 설정 (케이스별 최적화)
    const apiOption = this.buildApiOptions(problemAnalysis, visits.length, vehicles.length, optionsWithCapacity);
    
    // 9. 최종 요청 객체 구성
    const request = this.buildFinalRequest(depot, visits, vehicles, apiOption, problemAnalysis, optionsWithCapacity);
    
    // 10. 요청 유효성 검증
    this.validateRequest(request, problemAnalysis);
    
    console.error(`📦 API 요청 생성 완료: ${visits.length}개 방문지, ${vehicles.length}대 차량 (용량제약: ${finalCapacityConstraint})`);
    return request;
  }

  // 문제 유형 자동 감지
  private analyzeProblemType(drivers: Driver[], orders: Order[], depots: Depot[], options?: any) {
    // 명시적으로 enableCapacityConstraint가 설정된 경우 그 값을 우선 사용
    let hasCapacity;
    if (options?.enableCapacityConstraint !== undefined) {
      hasCapacity = options.enableCapacityConstraint;
    } else {
      // 옵션이 없는 경우 데이터 기반으로 감지
      hasCapacity = drivers.some(d => Number(d.capacity) > 0) ||
                   orders.some(o => Number(o.weight) > 0 || Number(o.volume) > 0);
    }
    
    const hasTimeWindows = options?.enableTimeWindowConstraint ||
                          orders.some(o => o.time_window_start && o.time_window_end);
    
    const hasWorkingHours = drivers.some(d => d.working_hours_start || d.working_hours_end);
    
    const hasPreferences = drivers.some(d => 
      d.visit_preference_1 !== undefined || 
      d.visit_preference_2 !== undefined ||
      d.visit_preference_3 !== undefined ||
      d.visit_preference_4 !== undefined
    );
    
    const hasMultiObjective = drivers.some(d => 
      Number(d.fixed_cost) > 0 || 
      Number(d.unit_distance_cost) > 0 || 
      Number(d.unit_duration_cost) > 0
    );
    
    const hasDiverseVehicleTypes = new Set(drivers.map(d => d.vehicle_type || 'car')).size > 1;
    
    // 케이스 분류
    let type = 'TSP';
    let complexity = 'Low';
    
    if (drivers.length === 1 && !hasCapacity && !hasTimeWindows) {
      type = 'TSP';
      complexity = 'Low';
    } else if (hasCapacity && !hasTimeWindows && !hasWorkingHours && !hasPreferences) {
      type = 'CVRP';
      complexity = 'Medium';
    } else if (hasCapacity && hasTimeWindows) {
      type = 'CVRPTW'; 
      complexity = 'High';
    } else if (hasCapacity && hasWorkingHours) {
      type = 'CVRP_Driver_Shifts';
      complexity = 'Medium-High';
    } else if (hasPreferences || hasDiverseVehicleTypes) {
      type = 'CVRP_Preferences';
      complexity = 'Medium';
    } else if (hasMultiObjective) {
      type = 'Multi_Objective_CVRP';
      complexity = 'Medium-High';
    } else if (drivers.length > 1) {
      type = 'CVRP';
      complexity = 'Medium';
    }
    
    return {
      type,
      complexity,
      hasCapacity,
      hasTimeWindows,
      hasWorkingHours,
      hasPreferences,
      hasMultiObjective,
      hasDiverseVehicleTypes,
      isLargeProblem: orders.length > 1000 || drivers.length > 50
    };
  }

  // Depot 구성 (주소 정보 포함)
  private buildDepot(depots: Depot[], drivers: Driver[]): any {
    let depot;
    
    if (depots.length > 0) {
      const depotLng = Number(depots[0].lng);
      const depotLat = Number(depots[0].lat);
      
      if (isNaN(depotLng) || isNaN(depotLat) || depotLng < -180 || depotLng > 180 || depotLat < -90 || depotLat > 90) {
        throw new TMSError(
          `창고 좌표가 유효하지 않습니다: lng=${depots[0].lng}, lat=${depots[0].lat}`,
          'INVALID_DEPOT_COORDINATES',
          { depot: depots[0] }
        );
      }
      
      depot = {
        name: depots[0].name || 'Main Depot',
        coordinate: { lng: depotLng, lat: depotLat }
        // 주소 정보는 API v2에서 지원하지 않으므로 제외
        // ...(depots[0].address && { address: depots[0].address })
      };
      
    } else if (drivers.length > 0) {
      const driverLng = Number(drivers[0].start_location_lng);
      const driverLat = Number(drivers[0].start_location_lat);
      
      if (isNaN(driverLng) || isNaN(driverLat) || driverLng < -180 || driverLng > 180 || driverLat < -90 || driverLat > 90) {
        throw new TMSError(
          `운전자 ${drivers[0].name} 시작 좌표가 유효하지 않습니다: lng=${drivers[0].start_location_lng}, lat=${drivers[0].start_location_lat}`,
          'INVALID_DRIVER_COORDINATES',
          { driver: drivers[0] }
        );
      }
      
      depot = {
        name: 'Default Depot',
        coordinate: { lng: driverLng, lat: driverLat }
      };
    } else {
      throw new TMSError(
        '최소한 하나의 운전자 또는 창고가 필요합니다',
        'INSUFFICIENT_DATA'
      );
    }
    
    return depot;
  }

  // Visits 구성 (케이스별 특성 반영)
  private buildVisits(orders: Order[], problemAnalysis: any): any[] {
    return orders.map((order, index) => {
      // 좌표 검증
      const lng = Number(order.delivery_lng);
      const lat = Number(order.delivery_lat);
      
      if (isNaN(lng) || isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new TMSError(
          `주문 ${order.order_id}의 좌표가 유효하지 않습니다: lng=${order.delivery_lng}, lat=${order.delivery_lat}`,
          'INVALID_COORDINATES',
          { order_id: order.order_id, lng: order.delivery_lng, lat: order.delivery_lat }
        );
      }

      const visit: any = {
        name: order.order_id || `Order_${index + 1}`,
        coordinate: { lng, lat }
      };

      // 주소 정보는 API v2에서 지원하지 않으므로 제외
      // if (order.address) {
      //   visit.address = order.address;
      // }

      // 용량 제약이 있는 경우에만 weight/volume 추가
      if (problemAnalysis.hasCapacity) {
        visit.weight = Math.max(0, Number(order.weight) || 0);
        visit.volume = Math.max(0, Number(order.volume) || 0);
      }

      // 우선순위 기반 미할당 페널티 (선호도 케이스에서 중요)
      if (problemAnalysis.hasPreferences && order.priority) {
        visit.unassigned_penalty = Math.round(1000 / order.priority);
      } else if (problemAnalysis.type !== 'TSP') {
        visit.unassigned_penalty = 100; // 기본값
      }

      // 시간창이 있는 경우 처리 (CVRPTW)
      if (problemAnalysis.hasTimeWindows && order.time_window_start && order.time_window_end) {
        // 예제에서는 전체 날짜가 포함된 형식 사용
        if (order.time_window_start.includes('T')) {
          visit.time_window = [order.time_window_start, order.time_window_end];
        } else {
          // HH:MM 형식인 경우 오늘 날짜 추가
          const today = new Date().toISOString().split('T')[0];
          visit.time_window = [
            `${today}T${order.time_window_start}:00Z`,
            `${today}T${order.time_window_end}:00Z`
          ];
        }
        
        // 서비스 시간 추가 (예제 패턴)
        visit.service_time = Number(order.service_time) || 10; // 기본 10분
      }

      return visit;
    });
  }

  // Vehicles 구성 (케이스별 특성 반영)
  private buildVehicles(drivers: Driver[], problemAnalysis: any): any[] {
    return drivers.map((driver, index) => {
      const vehicle: any = {
        name: driver.name || `Vehicle_${index + 1}`,
        vehicle_type: (driver.vehicle_type || 'car').trim()
      };

      // 용량 제약이 있는 경우에만 용량 필드 추가
      if (problemAnalysis.hasCapacity) {
        vehicle.weight_capacity = Math.max(1, Number(driver.capacity) || 1000);
        if (Number(driver.volume_capacity) > 0) {
          vehicle.volume_capacity = Number(driver.volume_capacity);
        } else {
          vehicle.volume_capacity = vehicle.weight_capacity; // 기본값으로 weight_capacity 사용
        }
      }

      // 다목적 최적화 비용 구조 (case_6)
      if (problemAnalysis.hasMultiObjective) {
        vehicle.fixed_cost = Number(driver.fixed_cost) || 0;
        vehicle.unit_distance_cost = Number(driver.unit_distance_cost) || Number(driver.cost_per_km) || 1;
        vehicle.unit_duration_cost = Number(driver.unit_duration_cost) || 0;
      } else {
        // 기본 비용 구조
        vehicle.fixed_cost = 0;
        vehicle.unit_distance_cost = Math.max(0, Number(driver.cost_per_km) || 1);
        vehicle.unit_duration_cost = 0;
      }

      // 기본 설정
      vehicle.return_to_depot = true;

          // 근무시간 제약 (case_4) 감지 시 hasTimeWindows도 true로 설정
    if (problemAnalysis.hasWorkingHours) {
      problemAnalysis.hasTimeWindows = true; // 근무시간이 있으면 시간창 처리 로직 활성화
        if (driver.working_hours_start) {
          // 예제에서는 timezone이 포함된 형식 사용
          if (driver.working_hours_start.includes('+') || driver.working_hours_start.includes('Z')) {
            vehicle.work_start_time = driver.working_hours_start;
          } else if (driver.working_hours_start.includes('T')) {
            vehicle.work_start_time = driver.working_hours_start;
          } else {
            // HH:MM 형식인 경우 오늘 날짜 추가
            const today = new Date().toISOString().split('T')[0];
            vehicle.work_start_time = `${today}T${driver.working_hours_start}:00Z`;
          }
        }
        
        if (driver.working_hours_end) {
          if (driver.working_hours_end.includes('+') || driver.working_hours_end.includes('Z')) {
            vehicle.work_end_time = driver.working_hours_end;
          } else if (driver.working_hours_end.includes('T')) {
            vehicle.work_end_time = driver.working_hours_end;
          } else {
            const today = new Date().toISOString().split('T')[0];
            vehicle.work_end_time = `${today}T${driver.working_hours_end}:00Z`;
          }
        }
      }

      // 선호도 정보 (case_5)
      if (problemAnalysis.hasPreferences) {
        const preferences = [];
        if (driver.visit_preference_1 !== undefined) preferences.push(Number(driver.visit_preference_1));
        if (driver.visit_preference_2 !== undefined) preferences.push(Number(driver.visit_preference_2));
        if (driver.visit_preference_3 !== undefined) preferences.push(Number(driver.visit_preference_3));
        if (driver.visit_preference_4 !== undefined) preferences.push(Number(driver.visit_preference_4));
        
        if (preferences.length > 0) {
          vehicle.visit_preference = preferences;
        }
      }

      return vehicle;
    });
  }

  // API 옵션 설정 (케이스별 최적화)
  private buildApiOptions(problemAnalysis: any, visitCount: number, vehicleCount: number, options?: any): any {
    // 케이스별 시간 제한 (예제 기준)
    let timelimit = 10; // 기본값
    
    switch (problemAnalysis.type) {
      case 'TSP':
      case 'CVRP':
        timelimit = 10;
        break;
      case 'CVRP_Preferences':
        timelimit = 15;
        break;
      case 'CVRP_Driver_Shifts':
      case 'Multi_Objective_CVRP':
        timelimit = 20;
        break;
      case 'CVRPTW':
        timelimit = 30;
        break;
      default:
        timelimit = problemAnalysis.isLargeProblem ? 300 : 
                   (problemAnalysis.hasTimeWindows ? 30 : 10);
    }

    // 사용자 지정 시간 제한이 있으면 우선 사용
    if (options?.timeLimit) {
      timelimit = options.timeLimit;
    }

    // 목적 함수 결정 (예제에서는 모두 minsum 사용)
    let objective_type: 'minsum' | 'minmax' = 'minsum';
    
    // 특별한 경우에만 minmax 사용 (대규모 TSP나 특정 조건)
    if (problemAnalysis.type === 'TSP' && vehicleCount > 1) {
      objective_type = 'minmax';
    } else if (options?.objective === 'minmax') {
      objective_type = 'minmax';
    }

    const apiOptions: any = {
      objective_type,
      timelimit,
      distance_type: options?.distanceType || 'euclidean',
      allow_unassigned_visits: options?.allowUnassignedVisits ?? problemAnalysis.isLargeProblem,
      use_large_size_optimization_algorithm: problemAnalysis.isLargeProblem,
      include_departure_cost_from_depot: true,
      include_return_cost_to_depot: true
    };

    // OMELET API v2에서는 용량 제약과 시간창 제약을 별도 필드로 설정하지 않음
    // 대신 vehicles에 capacity가 있고 visits에 weight/volume이 있으면 자동 적용
    // 시간창 제약도 visits에 time_window가 있으면 자동 적용

    return apiOptions;
  }

  // 최종 요청 객체 구성
  private buildFinalRequest(depot: any, visits: any[], vehicles: any[], apiOption: any, problemAnalysis: any, options?: any): any {
    const request: any = {
      depot,
      visits,
      vehicles,
      option: apiOption
    };

    // 시간 제약이 있는 경우 delivery_start_time 추가 (CVRPTW)
    if (problemAnalysis.hasTimeWindows && options?.deliveryStartTime) {
      request.delivery_start_time = options.deliveryStartTime;
    }

    return request;
  }

  // 요청 유효성 검증
  private validateRequest(request: any, problemAnalysis: any): void {
    // 기본 필드 검증
    if (!request.depot || !request.visits || !request.vehicles || !request.option) {
      throw new TMSError('필수 요청 필드가 누락되었습니다', 'INVALID_REQUEST');
    }

    // 방문지 수 검증
    if (request.visits.length === 0) {
      throw new TMSError('최소 1개의 방문지가 필요합니다', 'NO_VISITS');
    }

    // 차량 수 검증
    if (request.vehicles.length === 0) {
      throw new TMSError('최소 1대의 차량이 필요합니다', 'NO_VEHICLES');
    }

    // 용량 제약 검증
    if (problemAnalysis.hasCapacity) {
      const totalDemand = request.visits.reduce((sum: number, visit: any) => 
        sum + (Number(visit.weight) || 0), 0);
      const totalCapacity = request.vehicles.reduce((sum: number, vehicle: any) => 
        sum + (Number(vehicle.weight_capacity) || 0), 0);
      
      if (totalDemand > totalCapacity) {
        console.warn(`⚠️ 총 수요량(${totalDemand})이 총 차량 용량(${totalCapacity})을 초과합니다`);
      }
    }

    // 시간창 검증
    if (problemAnalysis.hasTimeWindows) {
      const hasInvalidTimeWindows = request.visits.some((visit: any) => {
        if (visit.time_window && visit.time_window.length === 2) {
          const start = new Date(visit.time_window[0]);
          const end = new Date(visit.time_window[1]);
          return start >= end;
        }
        return false;
      });
      
      if (hasInvalidTimeWindows) {
        throw new TMSError('잘못된 시간창이 발견되었습니다 (시작시간 >= 종료시간)', 'INVALID_TIME_WINDOWS');
      }
    }

    console.error(`✅ 요청 검증 완료: ${problemAnalysis.type} 케이스`);
  }

  // 오류 처리
  private handleApiError(error: any): never {
    if (error instanceof TMSError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.response?.data?.detail || error.message;

      switch (status) {
        case 400:
          throw new TMSError(
            `잘못된 요청: ${message}`,
            'BAD_REQUEST',
            error.response?.data,
            [
              '요청 데이터 형식을 확인해주세요',
              '필수 필드가 모두 있는지 확인해주세요',
              'API 스펙에 맞는 데이터 타입인지 확인해주세요'
            ]
          );
        
        case 401:
          throw new TMSError(
            'API 키가 유효하지 않습니다',
            'UNAUTHORIZED',
            error.response?.data,
            [
              'API 키를 확인해주세요',
              '.env 파일의 OMELET_API_KEY를 확인해주세요',
              'X-API-KEY 헤더가 올바른지 확인해주세요'
            ]
          );
        
        case 403:
          throw new TMSError(
            'API 접근이 거부되었습니다',
            'FORBIDDEN',
            error.response?.data,
            ['API 키 권한을 확인해주세요', '요청 제한이 있는지 확인해주세요']
          );
        
        case 404:
          throw new TMSError(
            '요청한 리소스를 찾을 수 없습니다',
            'NOT_FOUND',
            error.response?.data,
            ['API 엔드포인트를 확인해주세요', '작업 ID가 올바른지 확인해주세요']
          );
        
        case 405:
          throw new TMSError(
            '허용되지 않은 HTTP 메소드입니다',
            'METHOD_NOT_ALLOWED',
            error.response?.data,
            ['HTTP 메소드(GET/POST)를 확인해주세요']
          );
        
        case 406:
          throw new TMSError(
            'Accept 헤더가 올바르지 않습니다',
            'NOT_ACCEPTABLE',
            error.response?.data,
            ['Accept 헤더를 "application/vnd.omelet.v2+json"으로 설정해주세요']
          );
        
        case 422:
          throw new TMSError(
            `처리할 수 없는 요청: ${message}`,
            'UNPROCESSABLE_ENTITY',
            error.response?.data,
            [
              '요청 데이터의 유효성을 확인해주세요',
              '비즈니스 로직 제약조건을 확인해주세요'
            ]
          );
        
        case 429:
          throw new TMSError(
            'API 요청 한도를 초과했습니다',
            'RATE_LIMIT',
            error.response?.data,
            [
              '잠시 후 다시 시도해주세요',
              '대규모 문제의 경우 vrp-long 엔드포인트를 사용하세요'
            ]
          );
        
        case 500:
          throw new TMSError(
            'OMELET 서버 내부 오류',
            'SERVER_ERROR',
            error.response?.data,
            ['잠시 후 다시 시도해주세요', '문제가 계속되면 관리자에게 문의하세요']
          );
        
        default:
          throw new TMSError(
            `HTTP 오류 ${status}: ${message}`,
            'HTTP_ERROR',
            error.response?.data,
            ['네트워크 연결을 확인해주세요', 'API 서버 상태를 확인해주세요']
          );
      }
    }

    throw new TMSError(
      `알 수 없는 오류: ${error.message || error}`,
      'UNKNOWN_ERROR',
      error
    );
  }

  // 응답 유효성 검증
  validateResponse(response: ProcessedOmeletResponse): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 필수 필드 검증
    if (!response.status) {
      issues.push('응답에 status 필드가 없습니다');
    }

    if (!Array.isArray(response.routes)) {
      issues.push('응답에 routes 배열이 없습니다');
    }

    if (typeof response.total_cost !== 'number') {
      issues.push('total_cost가 숫자가 아닙니다');
    }

    // 경고 사항
    if (response.status === 'feasible_with_unassigned_visits') {
      warnings.push(`${response.unassigned_visits?.length || 0}개의 주문이 할당되지 않았습니다`);
    }

    if (response.status === 'time_limit_exceeded') {
      warnings.push('시간 제한으로 인해 최적이 아닐 수 있습니다');
    }

    if (response.routes.length === 0) {
      warnings.push('생성된 경로가 없습니다');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }
} 