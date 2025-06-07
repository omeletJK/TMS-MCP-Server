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
      timeout: 30000, // 30초 기본 타임아웃
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
        console.error('❌ API 응답 오류:', error.response?.status, error.response?.statusText);
        if (error.response?.data) {
          console.error('📄 오류 세부사항:', error.response.data);
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

  // 데이터를 OMELET API v2 형식으로 변환
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
    
    // 시간 제약 조건 확인
    const hasTimeConstraints = options?.enableTimeWindowConstraint || 
                               orders.some(order => order.time_window_start && order.time_window_end) ||
                               drivers.some(driver => driver.working_hours_start || driver.working_hours_end);
    
    // Depot 설정 (검증 강화)
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
        index: 0,
        coordinate: { lng: depotLng, lat: depotLat }
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
        index: 0,
        coordinate: { lng: driverLng, lat: driverLat }
      };
    } else {
      throw new TMSError(
        '최소한 하나의 운전자 또는 창고가 필요합니다',
        'INSUFFICIENT_DATA'
      );
    }

    // Visits 변환 (검증 강화)
    const visits = orders.map((order, index) => {
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
        index: index + 1, // depot은 0, visits는 1부터 시작
        coordinate: { lng, lat },
        volume: Math.max(0, Number(order.volume) || 0),
        weight: Math.max(0, Number(order.weight) || 0),
        unassigned_penalty: order.priority ? Math.round(1000 / order.priority) : 100
      };

      // 시간 제약이 있는 경우에만 service_time 추가
      if (hasTimeConstraints) {
        visit.service_time = 10; // 기본 10분
      }

      // 시간창이 있는 경우에만 추가 (UTC timezone 포함 ISO 8601 형식)
      if (order.time_window_start && order.time_window_end) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        visit.time_window = [
          `${today}T${order.time_window_start}:00Z`,
          `${today}T${order.time_window_end}:00Z`
        ];
      }

      return visit;
    });

    // Vehicles 변환 (검증 강화)
    const vehicles = drivers.map((driver, index) => {
      const vehicle: any = {
        name: driver.name || `Vehicle_${index + 1}`,
        volume_capacity: Math.max(1, Number(driver.capacity) || 1000),
        weight_capacity: Math.max(1, Number(driver.capacity) || 1000), 
        fixed_cost: 0,
        unit_distance_cost: Math.max(0, Number(driver.cost_per_km) || 1),
        unit_duration_cost: 0,
        vehicle_type: 'car' as const,
        return_to_depot: true
      };

      // 근무시간이 있는 경우에만 추가 (UTC timezone 포함 ISO 8601 형식)
      if (driver.working_hours_start) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        vehicle.work_start_time = `${today}T${driver.working_hours_start}:00Z`;
      }
      if (driver.working_hours_end) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        vehicle.work_end_time = `${today}T${driver.working_hours_end}:00Z`;
      }

      return vehicle;
    });

    // API 옵션 설정 (OMELET API v2 스펙 준수)
    const apiOption = {
      timelimit: Math.min(options?.timeLimit || 30, 120), // API 제한 120초 적용
      objective_type: (options?.objective === 'minmax') ? 'minmax' as const : 'minsum' as const, // minsum/minmax만 지원
      distance_type: options?.distanceType || 'euclidean',
      allow_unassigned_visits: options?.allowUnassignedVisits || false,
      use_large_size_optimization_algorithm: (visits.length > 50 || vehicles.length > 5), // 더 보수적인 기준
      include_departure_cost_from_depot: true,
      include_return_cost_to_depot: true
    };

    // 기본 요청 객체
    const request: any = {
      depot,
      visits,
      vehicles,
      option: apiOption
    };

    // 시간 제약이 있는 경우에만 delivery_start_time 추가
    if (hasTimeConstraints && options?.deliveryStartTime) {
      request.delivery_start_time = options.deliveryStartTime;
    }

    return request;
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