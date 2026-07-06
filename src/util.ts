import type { SubsidyProgram, SubsidyStatus } from "./types.js";

const KST_OFFSET = "+09:00";

/** 한국 시간 기준 오늘 날짜를 YYYY-MM-DD로 반환 */
export function todayKST(): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

/** "20260701", "2026-07-01", "2026.07.01" 등 다양한 표기를 YYYY-MM-DD로 정규화 */
export function normalizeDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length < 8) return undefined;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const mi = Number(m), di = Number(d);
  if (Number(y) < 2000 || mi < 1 || mi > 12 || di < 1 || di > 31) return undefined;
  return `${y}-${m}-${d}`;
}

/** "2026-06-01 ~ 2026-07-15" 류의 기간 문자열에서 시작/종료일 추출 */
export function parseDateRange(raw: string | undefined | null): { start?: string; end?: string } {
  if (!raw) return {};
  const matches = String(raw).match(/\d{4}[-./]?\s?\d{2}[-./]?\s?\d{2}/g);
  if (!matches || matches.length === 0) return {};
  const start = normalizeDate(matches[0]);
  const end = matches.length > 1 ? normalizeDate(matches[matches.length - 1]) : undefined;
  return { start, end };
}

/** 접수 시작/마감일 기준 상태 계산 */
export function computeStatus(applyStart?: string, applyEnd?: string): SubsidyStatus {
  const today = todayKST();
  if (applyStart && applyStart > today) return "upcoming";
  if (applyEnd && applyEnd < today) return "closed";
  if (applyStart || applyEnd) return "open";
  return "unknown";
}

/** HTML 태그 및 엔티티 제거 */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** YYYY-MM-DD를 KST ISO8601 시각으로 변환 */
export function toKstIso(date: string, time = "09:00:00"): string {
  return `${date}T${time}${KST_OFFSET}`;
}

/** 마감일까지 남은 일수 (음수면 지남) */
export function daysUntil(date: string): number {
  const today = new Date(`${todayKST()}T00:00:00${KST_OFFSET}`).getTime();
  const target = new Date(`${date}T00:00:00${KST_OFFSET}`).getTime();
  return Math.round((target - today) / 86400000);
}

/** 프로그램 목록에서 키워드/지역/상태 필터 적용 */
export function applyFilters(
  programs: SubsidyProgram[],
  opts: { keyword?: string; region?: string; status?: string },
): SubsidyProgram[] {
  let out = programs;
  if (opts.keyword) {
    const kws = opts.keyword.trim().toLowerCase().split(/\s+/);
    out = out.filter((p) => {
      const hay = `${p.title} ${p.summary ?? ""} ${p.target ?? ""} ${p.organization ?? ""}`.toLowerCase();
      return kws.every((kw) => hay.includes(kw));
    });
  }
  if (opts.region) {
    const r = opts.region.trim();
    out = out.filter(
      (p) => !p.region || p.region.includes(r) || p.region.includes("전국") || r === "전국",
    );
  }
  if (opts.status && opts.status !== "all") {
    out = out.filter((p) => p.status === opts.status);
  }
  return out;
}

/** 중복 제거: 제목+기관 기준 (여러 소스에 같은 공고가 올라오는 경우) */
export function dedupePrograms(programs: SubsidyProgram[]): SubsidyProgram[] {
  const seen = new Map<string, SubsidyProgram>();
  for (const p of programs) {
    const key = `${p.title.replace(/\s+/g, "")}|${p.organization ?? ""}`;
    const prev = seen.get(key);
    // 마감일 정보가 더 충실한 쪽을 유지
    if (!prev || (!prev.applyEnd && p.applyEnd)) seen.set(key, p);
  }
  return [...seen.values()];
}

/** fetch에 타임아웃 적용 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 단순 TTL 인메모리 캐시 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
