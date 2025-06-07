import { z } from 'zod';

// ===== CSV 스키마 정의 =====

// 운전자 CSV 스키마
export const DriverSchema = z.object({
  driver_id: z.string(),
  name: z.string().optional(),
  start_location_lat: z.number(),
  start_location_lng: z.number(),
  end_location_lat: z.number().optional(),
  end_location_lng: z.number().optional(),
  capacity: z.number(),
  working_hours_start: z.string().optional(),
  working_hours_end: z.string().optional(),
  cost_per_km: z.number().optional(),
});

// 주문 CSV 스키마
export const OrderSchema = z.object({
  order_id: z.string(),
  customer_name: z.string().optional(),
  pickup_lat: z.number(),
  pickup_lng: z.number(),
  delivery_lat: z.number(),
  delivery_lng: z.number(),
  weight: z.number().optional(),
  volume: z.number().optional(),
  time_window_start: z.string().optional(),
  time_window_end: z.string().optional(),
  priority: z.number().optional(),
});

// 창고 CSV 스키마
export const DepotSchema = z.object({
  depot_id: z.string(),
  name: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number().optional(),
  operating_hours_start: z.string().optional(),
  operating_hours_end: z.string().optional(),
});

export type Driver = z.infer<typeof DriverSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Depot = z.infer<typeof DepotSchema>;

// ===== OMELET API v2 타입 정의 =====

interface Coordinate {
  lng: number;
  lat: number;
}

export interface OmeletDepot {
  name?: string | null;
  index?: number;
  coordinate?: Coordinate | null;
}

export interface OmeletVisit {
  name?: string | null;
  index?: number | null;
  service_time?: number;
  coordinate?: Coordinate | null;
  volume?: number;
  weight?: number;
  unassigned_penalty?: number;
  time_window?: [string, string] | null;
}

export interface OmeletVehicle {
  name?: string | null;
  volume_capacity?: number;
  weight_capacity?: number;
  fixed_cost?: number;
  unit_distance_cost?: number;
  unit_duration_cost?: number;
  work_start_time?: string | null;
  work_end_time?: string | null;
  visit_preference?: number[] | null;
  vehicle_type?: 'bike' | 'car' | 'walk';
  return_to_depot?: boolean;
}

export interface ApiOption {
  timelimit?: number;
  objective_type?: 'minsum' | 'minmax';
  distance_type?: 'manhattan' | 'euclidean' | 'osrm';
  allow_unassigned_visits?: boolean;
  use_large_size_optimization_algorithm?: boolean;
  include_departure_cost_from_depot?: boolean;
  include_return_cost_to_depot?: boolean;
}

export interface OmeletRequest {
  depot: OmeletDepot;
  visits: OmeletVisit[];
  vehicles: OmeletVehicle[];
  distance_matrix?: number[][] | null;
  duration_matrix?: number[][] | null;
  delivery_start_time?: string | null;
  option?: ApiOption;
}

// ===== OMELET API v2 응답 타입 정의 =====

interface RouteCostDetails {
  objective_cost: number;
  distance_cost: number;
  duration_cost: number;
  fixed_cost: number;
}

interface SolutionCostDetails {
  total_objective_cost: number;
  total_distance_cost: number;
  total_duration_cost: number;
  max_distance_cost: number;
  max_duration_cost: number;
  total_fixed_cost: number;
  unassigned_penalty_cost: number;
}

interface RoutingEngineResult {
  routes: Array<{
    vehicle_name: string;
    route_index: number[];
    route_name: string[];
    route_cost_details: RouteCostDetails;
  }>;
  unassigned_visit_indices: number[];
  unassigned_visit_names: string[];
  solution_cost_details: SolutionCostDetails;
}

export interface OmeletResponse {
  routing_engine_result: RoutingEngineResult;
  status: 'feasible' | 'optimal' | 'infeasible' | 'feasible_with_unassigned_visits' | 'time_limit_exceeded';
  detail: string;
  job_id: string;
}

// 우리 시스템에서 사용할 변환된 구조
export interface OmeletRoute {
  vehicle_name: string;
  visits: Array<{
    visit_name: string;
    arrival_time?: string;
    departure_time?: string;
  }>;
  total_distance: number;
  total_duration: number;
  total_cost: number;
}

export interface ProcessedOmeletResponse {
  status: 'feasible' | 'optimal' | 'infeasible' | 'feasible_with_unassigned_visits' | 'time_limit_exceeded';
  routes: OmeletRoute[];
  unassigned_visits: string[];
  total_distance: number;
  total_duration: number;
  total_cost: number;
  detail: string;
}

export interface LongApiOutput {
  job_id: string;
  status: string;
  message?: string;
}

export interface CheckRoutingEngineOutput {
  status: 'processing' | 'completed' | 'failed';
  result?: OmeletResponse;
  message?: string;
}

// ===== 최적화 설정 타입 =====

export interface OptimizationConfig {
  objective: 'cost' | 'time' | 'distance' | 'satisfaction';
  constraints: {
    vehicle_capacity: boolean;
    time_windows: boolean;
    working_hours: boolean;
    max_vehicles?: number;
  };
  advanced_options: {
    multi_depot: boolean;
    priority_delivery: boolean;
    optimization_intensity: 'fast' | 'balanced' | 'thorough';
  };
  business_rules?: {
    break_duration?: number;
    max_working_hours?: number;
    fuel_cost_per_km?: number;
  };
}

// ===== 세션 관리 타입 =====

export interface ProjectSession {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  current_step: number;
  steps_completed: string[];
  data_status: {
    drivers_loaded: boolean;
    orders_loaded: boolean;
    depots_loaded: boolean;
    validation_passed: boolean;
  };
  config?: OptimizationConfig;
  last_result?: ProcessedOmeletResponse;
  files_processed: string[];
}

// ===== 분석 결과 타입 =====

export interface OptimizationAnalysis {
  summary: {
    total_routes: number;
    total_distance: number;
    total_duration: number;
    total_cost: number;
    vehicle_utilization: number;
    unassigned_orders: number;
  };
  vehicle_analysis: Array<{
    vehicle_name: string;
    route_distance: number;
    route_duration: number;
    orders_count: number;
    capacity_utilization: number;
    efficiency_score: number;
  }>;
  issues: Array<{
    type: 'warning' | 'error' | 'info';
    message: string;
    vehicle_name?: string;
    order_id?: string;
    suggestion?: string;
  }>;
}

// ===== 내보내기 옵션 타입 =====

export interface ExportOptions {
  excel: {
    include_schedules: boolean;
    include_dashboard: boolean;
    include_comparison: boolean;
  };
  pdf: {
    include_summary: boolean;
    include_maps: boolean;
    include_qr_codes: boolean;
  };
  templates: {
    save_config: boolean;
    driver_checklist: boolean;
    manager_dashboard: boolean;
  };
}

// ===== 에러 타입 =====

export class TMSError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
    public suggestions?: string[]
  ) {
    super(message);
    this.name = 'TMSError';
  }
}

export interface ValidationError {
  field: string;
  value: any;
  message: string;
  row?: number;
  file?: string;
  suggestion?: string;
}

// ===== 유틸리티 타입 =====

export type WorkflowStep = 
  | 'start_project'
  | 'prepare_data'
  | 'configure_problem'
  | 'solve_optimization'
  | 'analyze_results'
  | 'refine_solution'
  | 'export_results';

export interface StepGuide {
  step: WorkflowStep;
  title: string;
  description: string;
  next_step?: WorkflowStep;
  required_data?: string[];
  estimated_time?: string;
} 