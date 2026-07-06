/** 보조금/지원사업 공고의 통합(normalized) 표현 */
export interface SubsidyProgram {
  /** 소스 접두어가 붙은 고유 ID (예: "bizinfo:PBLN_000000000099999") */
  id: string;
  /** 데이터 출처 시스템 식별자 */
  source: SourceId;
  /** 출처 시스템의 한글 이름 (예: "기업마당") */
  sourceName: string;
  /** 사업/공고명 */
  title: string;
  /** 소관·주관 기관 */
  organization?: string;
  /** 지역 (전국 또는 시·도명) */
  region?: string;
  /** 분야/카테고리 (예: 금융, 기술, 인력, 수출, 창업 등) */
  category?: string;
  /** 지원 형태 (보조금, 융자, 바우처, 교육 등) */
  supportType?: string;
  /** 지원 대상 요약 */
  target?: string;
  /** 사업 개요 (HTML 태그 제거된 플레인 텍스트) */
  summary?: string;
  /** 접수 시작일 YYYY-MM-DD */
  applyStart?: string;
  /** 접수 마감일 YYYY-MM-DD */
  applyEnd?: string;
  /** 접수 상태 */
  status: SubsidyStatus;
  /** 상세 페이지 URL */
  url?: string;
  /** 공고 게시일 YYYY-MM-DD */
  postedAt?: string;
}

export type SubsidyStatus = "upcoming" | "open" | "closed" | "unknown";

export type SourceId = "bizinfo" | "gov24" | "mafra" | "nongupez";

export interface SearchFilters {
  /** 검색 키워드 (사업명/개요 대상) */
  keyword?: string;
  /** 지역 필터 (시·도명 부분일치, 예: "전북", "경기") */
  region?: string;
  /** 접수 상태 필터 */
  status?: SubsidyStatus | "all";
  /** 최대 반환 건수 */
  limit?: number;
}

/**
 * 톡캘린더 MCP(KakaotalkCal)의 CreateEvent 입력과 1:1 매핑되는 일정 페이로드.
 * CreateEvent(title*, time*(object), description?, reminders?) 형식을 따른다.
 */
export interface CalendarEventPayload {
  /** 일정 제목 */
  title: string;
  /** 일정 시간 정보 */
  time: {
    /** 시작 시각 ISO8601 (Asia/Seoul) */
    startAt: string;
    /** 종료 시각 ISO8601 (Asia/Seoul) */
    endAt: string;
    /** 하루종일 일정 여부 */
    allDay: boolean;
    /** IANA 타임존 */
    timeZone: string;
  };
  /** 일정 설명 (사업 요약 + 상세 링크) */
  description: string;
  /** 미리 알림(분 단위, 예: [1440, 10080] = 1일 전, 7일 전) */
  reminders: number[];
  /** 관련 보조금 ID (참고용) */
  subsidyId: string;
}
