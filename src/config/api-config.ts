import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const API_CONFIG = {
  BASE_URL: process.env.OMELET_BASE_URL || 'https://routing.oaasis.cc',
  API_KEY: process.env.OMELET_API_KEY || 'gEL1WT7K7DA4HuhjZ7DnJGFkVtDNTDBoZouhHepaHrw',
  
  ENDPOINTS: {
    VRP: '/api/vrp',
    VRP_LONG: '/api/vrp-long',
    HEALTH: '/api/health'
  },
  
  HEADERS: {
    'Accept': 'application/vnd.omelet.v2+json',
    'Content-Type': 'application/json'
  },
  
  TIMEOUTS: {
    STANDARD: 30000, // 30초
    LONG_RUNNING: 300000, // 5분
  },
  
  RETRY_CONFIG: {
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // 1초
    EXPONENTIAL_BACKOFF: true
  }
} as const;

// API 엔드포인트 선택 로직
export function selectEndpoint(orderCount: number, vehicleCount: number): string {
  // 대규모 문제 (주문 100개 이상 또는 차량 20대 이상)
  if (orderCount >= 100 || vehicleCount >= 20) {
    return API_CONFIG.ENDPOINTS.VRP_LONG;
  }
  
  return API_CONFIG.ENDPOINTS.VRP;
}

// API 헤더 생성
export function createHeaders(): Record<string, string> {
  return {
    ...API_CONFIG.HEADERS,
    'X-API-KEY': API_CONFIG.API_KEY
  };
}

// 타임아웃 선택
export function selectTimeout(orderCount: number): number {
  return orderCount >= 100 
    ? API_CONFIG.TIMEOUTS.LONG_RUNNING 
    : API_CONFIG.TIMEOUTS.STANDARD;
}

// API URL 생성
export function createApiUrl(endpoint: string): string {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
} 