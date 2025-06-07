import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import { 
  Driver, Order, Depot, 
  DriverSchema, OrderSchema, DepotSchema,
  ValidationError, TMSError 
} from '../types/index.js';

// CSV Writer 타입 정의
interface CSVWriterInstance {
  writeRecords(records: any[]): Promise<void>;
}

// 간단한 CSV 작성 함수
function createCSVWriter(filePath: string, headers: Array<{id: string, title: string}>): CSVWriterInstance {
  return {
    async writeRecords(records: any[]): Promise<void> {
      const headerLine = headers.map(h => h.title).join(',');
      const dataLines = records.map(record => 
        headers.map(h => {
          const value = record[h.id];
          return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(',')
      );
      
      const csvContent = [headerLine, ...dataLines].join('\n');
      await fs.writeFile(filePath, csvContent, 'utf8');
    }
  };
}

// 절대 경로를 사용하여 ProblemData 디렉토리 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROBLEM_DATA_DIR = path.join(__dirname, '..', '..', 'ProblemData');

// CSV 파일 정보
export const CSV_FILES = {
  DRIVERS: 'drivers.csv',
  ORDERS: 'orders.csv',
  DEPOTS: 'depots.csv'
} as const;

export class CSVProcessor {
  constructor() {
    this.ensureProblemDataDir();
  }

  private ensureProblemDataDir(): void {
    if (!fs.existsSync(PROBLEM_DATA_DIR)) {
      fs.mkdirSync(PROBLEM_DATA_DIR, { recursive: true });
    }
  }

  // CSV 파일 읽기
  async readCSV<T>(filename: string): Promise<T[]> {
    const filePath = path.join(PROBLEM_DATA_DIR, filename);
    
    if (!(await fs.pathExists(filePath))) {
      throw new TMSError(
        `CSV 파일을 찾을 수 없습니다: ${filename}`,
        'FILE_NOT_FOUND',
        { filePath },
        [`${filename} 파일을 ${PROBLEM_DATA_DIR} 폴더에 생성해주세요.`]
      );
    }

    return new Promise((resolve, reject) => {
      const results: T[] = [];
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          // 숫자 필드 변환
          const converted = this.convertNumericFields(data);
          results.push(converted);
        })
        .on('end', () => resolve(results))
        .on('error', (error) => reject(new TMSError(
          `CSV 파일 읽기 실패: ${filename}`,
          'CSV_READ_ERROR',
          error,
          ['파일 형식이 올바른지 확인해주세요.', 'UTF-8 인코딩으로 저장되었는지 확인해주세요.']
        )));
    });
  }

  // 운전자 데이터 읽기 및 검증
  async readDrivers(): Promise<{ data: Driver[]; errors: ValidationError[] }> {
    try {
      const rawData = await this.readCSV<any>(CSV_FILES.DRIVERS);
      return this.validateData(rawData, DriverSchema, 'drivers.csv');
    } catch (error) {
      if (error instanceof TMSError) {
        throw error;
      }
      throw new TMSError(
        '운전자 데이터 읽기 실패',
        'DRIVER_READ_ERROR',
        error
      );
    }
  }

  // 주문 데이터 읽기 및 검증
  async readOrders(): Promise<{ data: Order[]; errors: ValidationError[] }> {
    try {
      const rawData = await this.readCSV<any>(CSV_FILES.ORDERS);
      return this.validateData(rawData, OrderSchema, 'orders.csv');
    } catch (error) {
      if (error instanceof TMSError) {
        throw error;
      }
      throw new TMSError(
        '주문 데이터 읽기 실패',
        'ORDER_READ_ERROR',
        error
      );
    }
  }

  // 창고 데이터 읽기 및 검증
  async readDepots(): Promise<{ data: Depot[]; errors: ValidationError[] }> {
    try {
      const rawData = await this.readCSV<any>(CSV_FILES.DEPOTS);
      return this.validateData(rawData, DepotSchema, 'depots.csv');
    } catch (error) {
      if (error instanceof TMSError) {
        throw error;
      }
      throw new TMSError(
        '창고 데이터 읽기 실패',
        'DEPOT_READ_ERROR',
        error
      );
    }
  }

  // 데이터 검증
  private validateData<T>(
    rawData: any[], 
    schema: any, 
    filename: string
  ): { data: T[]; errors: ValidationError[] } {
    const validData: T[] = [];
    const errors: ValidationError[] = [];

    rawData.forEach((row, index) => {
      try {
        const validatedRow = schema.parse(row);
        validData.push(validatedRow);
      } catch (zodError: any) {
        if (zodError.issues) {
          zodError.issues.forEach((issue: any) => {
            errors.push({
              field: issue.path.join('.'),
              value: issue.received || row[issue.path[0]],
              message: issue.message,
              row: index + 2, // CSV 헤더 때문에 +2
              file: filename,
              suggestion: this.generateSuggestion(issue.path[0], issue.code, row)
            });
          });
        }
      }
    });

    return { data: validData, errors };
  }

  // 에러에 대한 수정 제안 생성
  private generateSuggestion(field: string, errorCode: string, row: any): string {
    switch (field) {
      case 'start_location_lat':
      case 'start_location_lng':
      case 'pickup_lat':
      case 'pickup_lng':
      case 'delivery_lat':
      case 'delivery_lng':
      case 'lat':
      case 'lng':
        return `좌표값은 숫자여야 합니다. 예: 37.5665 (위도), 126.9780 (경도)`;
      
      case 'capacity':
      case 'weight':
      case 'volume':
        return `용량/무게는 양수여야 합니다. 예: 1000`;
      
      case 'driver_id':
      case 'order_id':
      case 'depot_id':
        return `ID는 비어있을 수 없습니다. 고유한 문자열을 입력하세요.`;
      
      case 'working_hours_start':
      case 'working_hours_end':
      case 'time_window_start':
      case 'time_window_end':
        return `시간 형식: HH:MM 또는 YYYY-MM-DD HH:MM`;
      
      default:
        return `올바른 값을 입력해주세요.`;
    }
  }

  // 숫자 필드 자동 변환
  private convertNumericFields(data: any): any {
    const numericFields = [
      'start_location_lat', 'start_location_lng', 'end_location_lat', 'end_location_lng',
      'pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng',
      'lat', 'lng', 'capacity', 'weight', 'volume', 'priority', 'cost_per_km'
    ];

    const converted = { ...data };
    
    numericFields.forEach(field => {
      if (converted[field] !== undefined && converted[field] !== '') {
        const num = parseFloat(converted[field]);
        if (!isNaN(num)) {
          converted[field] = num;
        }
      }
    });

    return converted;
  }

  // 샘플 CSV 파일 생성
  async createSampleFiles(): Promise<void> {
    await Promise.all([
      this.createSampleDrivers(),
      this.createSampleOrders(),
      this.createSampleDepots()
    ]);
  }

  // 샘플 운전자 파일 생성
  private async createSampleDrivers(): Promise<void> {
    const filePath = path.join(PROBLEM_DATA_DIR, CSV_FILES.DRIVERS);
    
    if (await fs.pathExists(filePath)) {
      return; // 이미 존재하면 생성하지 않음
    }

    const csvWriterInstance = createCSVWriter(filePath, [
      { id: 'driver_id', title: 'driver_id' },
      { id: 'name', title: 'name' },
      { id: 'start_location_lat', title: 'start_location_lat' },
      { id: 'start_location_lng', title: 'start_location_lng' },
      { id: 'end_location_lat', title: 'end_location_lat' },
      { id: 'end_location_lng', title: 'end_location_lng' },
      { id: 'capacity', title: 'capacity' },
      { id: 'working_hours_start', title: 'working_hours_start' },
      { id: 'working_hours_end', title: 'working_hours_end' },
      { id: 'cost_per_km', title: 'cost_per_km' }
    ]);

    const sampleDrivers = [
      {
        driver_id: 'D001',
        name: '김민수',
        start_location_lat: 37.5665,
        start_location_lng: 126.9780,
        end_location_lat: 37.5665,
        end_location_lng: 126.9780,
        capacity: 1000,
        working_hours_start: '09:00',
        working_hours_end: '18:00',
        cost_per_km: 500
      },
      {
        driver_id: 'D002',
        name: '이영희',
        start_location_lat: 37.5505,
        start_location_lng: 126.9882,
        end_location_lat: 37.5505,
        end_location_lng: 126.9882,
        capacity: 1500,
        working_hours_start: '08:00',
        working_hours_end: '17:00',
        cost_per_km: 550
      },
      {
        driver_id: 'D003',
        name: '박철수',
        start_location_lat: 37.5642,
        start_location_lng: 126.9734,
        end_location_lat: 37.5642,
        end_location_lng: 126.9734,
        capacity: 2000,
        working_hours_start: '10:00',
        working_hours_end: '19:00',
        cost_per_km: 480
      }
    ];

    await csvWriterInstance.writeRecords(sampleDrivers);
  }

  // 샘플 주문 파일 생성
  private async createSampleOrders(): Promise<void> {
    const filePath = path.join(PROBLEM_DATA_DIR, CSV_FILES.ORDERS);
    
    if (await fs.pathExists(filePath)) {
      return;
    }

    const csvWriterInstance = createCSVWriter(filePath, [
      { id: 'order_id', title: 'order_id' },
      { id: 'customer_name', title: 'customer_name' },
      { id: 'pickup_lat', title: 'pickup_lat' },
      { id: 'pickup_lng', title: 'pickup_lng' },
      { id: 'delivery_lat', title: 'delivery_lat' },
      { id: 'delivery_lng', title: 'delivery_lng' },
      { id: 'weight', title: 'weight' },
      { id: 'volume', title: 'volume' },
      { id: 'time_window_start', title: 'time_window_start' },
      { id: 'time_window_end', title: 'time_window_end' },
      { id: 'priority', title: 'priority' }
    ]);

    const sampleOrders = [
      {
        order_id: 'O001',
        customer_name: '강남 고객사',
        pickup_lat: 37.5665,
        pickup_lng: 126.9780,
        delivery_lat: 37.5172,
        delivery_lng: 127.0473,
        weight: 150,
        volume: 50,
        time_window_start: '10:00',
        time_window_end: '12:00',
        priority: 1
      },
      {
        order_id: 'O002',
        customer_name: '홍대 고객사',
        pickup_lat: 37.5665,
        pickup_lng: 126.9780,
        delivery_lat: 37.5563,
        delivery_lng: 126.9236,
        weight: 200,
        volume: 75,
        time_window_start: '13:00',
        time_window_end: '15:00',
        priority: 2
      },
      {
        order_id: 'O003',
        customer_name: '잠실 고객사',
        pickup_lat: 37.5665,
        pickup_lng: 126.9780,
        delivery_lat: 37.5132,
        delivery_lng: 127.1028,
        weight: 100,
        volume: 30,
        time_window_start: '14:00',
        time_window_end: '16:00',
        priority: 1
      },
      {
        order_id: 'O004',
        customer_name: '마포 고객사',
        pickup_lat: 37.5665,
        pickup_lng: 126.9780,
        delivery_lat: 37.5447,
        delivery_lng: 126.9524,
        weight: 180,
        volume: 60,
        time_window_start: '15:00',
        time_window_end: '17:00',
        priority: 3
      },
      {
        order_id: 'O005',
        customer_name: '용산 고객사',
        pickup_lat: 37.5665,
        pickup_lng: 126.9780,
        delivery_lat: 37.5326,
        delivery_lng: 126.9910,
        weight: 120,
        volume: 40,
        time_window_start: '11:00',
        time_window_end: '13:00',
        priority: 2
      }
    ];

    await csvWriterInstance.writeRecords(sampleOrders);
  }

  // 샘플 창고 파일 생성
  private async createSampleDepots(): Promise<void> {
    const filePath = path.join(PROBLEM_DATA_DIR, CSV_FILES.DEPOTS);
    
    if (await fs.pathExists(filePath)) {
      return;
    }

    const csvWriterInstance = createCSVWriter(filePath, [
      { id: 'depot_id', title: 'depot_id' },
      { id: 'name', title: 'name' },
      { id: 'lat', title: 'lat' },
      { id: 'lng', title: 'lng' },
      { id: 'capacity', title: 'capacity' },
      { id: 'operating_hours_start', title: 'operating_hours_start' },
      { id: 'operating_hours_end', title: 'operating_hours_end' }
    ]);

    const sampleDepots = [
      {
        depot_id: 'DEPOT001',
        name: '서울 중앙 물류센터',
        lat: 37.5665,
        lng: 126.9780,
        capacity: 10000,
        operating_hours_start: '08:00',
        operating_hours_end: '20:00'
      }
    ];

    await csvWriterInstance.writeRecords(sampleDepots);
  }

  // 파일 존재 여부 확인
  async checkFilesExist(): Promise<{ 
    drivers: boolean; 
    orders: boolean; 
    depots: boolean; 
    all_exist: boolean 
  }> {
    const driversExist = await fs.pathExists(path.join(PROBLEM_DATA_DIR, CSV_FILES.DRIVERS));
    const ordersExist = await fs.pathExists(path.join(PROBLEM_DATA_DIR, CSV_FILES.ORDERS));
    const depotsExist = await fs.pathExists(path.join(PROBLEM_DATA_DIR, CSV_FILES.DEPOTS));

    return {
      drivers: driversExist,
      orders: ordersExist,
      depots: depotsExist,
      all_exist: driversExist && ordersExist && depotsExist
    };
  }

  // 데이터 요약 통계
  generateDataSummary(drivers: Driver[], orders: Order[], depots: Depot[]): string {
    let summary = `📊 **데이터 요약**\n\n`;
    
    // 운전자 정보
    summary += `🚗 **운전자 정보** (${drivers.length}명)\n`;
    if (drivers.length > 0) {
      const totalCapacity = drivers.reduce((sum, d) => sum + d.capacity, 0);
      const avgCapacity = Math.round(totalCapacity / drivers.length);
      summary += `- 총 용량: ${totalCapacity.toLocaleString()}\n`;
      summary += `- 평균 용량: ${avgCapacity.toLocaleString()}\n`;
    }
    summary += '\n';

    // 주문 정보
    summary += `📦 **주문 정보** (${orders.length}건)\n`;
    if (orders.length > 0) {
      const totalWeight = orders.reduce((sum, o) => sum + (o.weight || 0), 0);
      const totalVolume = orders.reduce((sum, o) => sum + (o.volume || 0), 0);
      summary += `- 총 무게: ${totalWeight.toLocaleString()}\n`;
      summary += `- 총 부피: ${totalVolume.toLocaleString()}\n`;
      
      const priorityOrders = orders.filter(o => o.priority === 1).length;
      if (priorityOrders > 0) {
        summary += `- 우선 배송: ${priorityOrders}건\n`;
      }
    }
    summary += '\n';

    // 창고 정보
    summary += `🏭 **창고 정보** (${depots.length}개)\n`;
    if (depots.length > 0) {
      const totalDepotCapacity = depots.reduce((sum, d) => sum + (d.capacity || 0), 0);
      summary += `- 총 저장 용량: ${totalDepotCapacity.toLocaleString()}\n`;
    }

    return summary;
  }
} 