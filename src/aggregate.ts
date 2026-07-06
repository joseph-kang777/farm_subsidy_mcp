import type { SubsidyProgram } from "./types.js";
import { dedupePrograms } from "./util.js";

export interface SubsidySource {
  id: string;
  name: string;
  /** 이 소스에서 농업 관련 공고를 수집해 정규화 목록으로 반환 */
  fetchPrograms(): Promise<SubsidyProgram[]>;
}

const sources: SubsidySource[] = [];

export function registerSource(source: SubsidySource): void {
  sources.push(source);
}

/**
 * PlayMCP 심사 기준(평균 100ms, p99 3s)을 만족하기 위해
 * 수집은 백그라운드에서 주기적으로 수행하고, tool 호출은 항상 메모리 캐시로 즉시 응답한다.
 */
let lastPrograms: SubsidyProgram[] = [];
let lastErrors: { source: string; message: string }[] = [];
let lastFetchedAt = 0;
let lastSourceCounts: Record<string, number> = {};
let refreshing: Promise<void> | null = null;

const STALE_MS = 15 * 60 * 1000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** 상태 우선 정렬: 접수중(마감 임박순) → 접수예정(시작 임박순) → 상시/미정(최신 게시순) → 마감(최근 마감순) */
function sortPrograms(list: SubsidyProgram[]): void {
  const STATUS_RANK: Record<string, number> = { open: 0, upcoming: 1, unknown: 2, closed: 3 };
  list.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    switch (a.status) {
      case "open":
        return (a.applyEnd ?? "9999-99-99").localeCompare(b.applyEnd ?? "9999-99-99");
      case "upcoming":
        return (a.applyStart ?? "9999-99-99").localeCompare(b.applyStart ?? "9999-99-99");
      case "closed":
        return (b.applyEnd ?? "0000-00-00").localeCompare(a.applyEnd ?? "0000-00-00");
      default:
        return (b.postedAt ?? "0000-00-00").localeCompare(a.postedAt ?? "0000-00-00");
    }
  });
}

async function refresh(): Promise<void> {
  const errors: { source: string; message: string }[] = [];
  const counts: Record<string, number> = {};
  const results = await Promise.allSettled(sources.map((s) => s.fetchPrograms()));
  const programs: SubsidyProgram[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      programs.push(...r.value);
      counts[sources[i].id] = r.value.length;
    } else {
      const cause = r.reason?.cause ? ` (cause: ${String(r.reason.cause)})` : "";
      errors.push({
        source: sources[i].name,
        message: `${String(r.reason?.message ?? r.reason)}${cause}`,
      });
      counts[sources[i].id] = -1;
      console.error(`[aggregate] source ${sources[i].id} failed:`, r.reason);
    }
  });
  lastSourceCounts = counts;

  const deduped = dedupePrograms(programs);
  sortPrograms(deduped);

  // 전 소스가 실패한 경우 기존 데이터를 유지 (서비스 연속성)
  if (deduped.length > 0 || lastPrograms.length === 0) {
    lastPrograms = deduped;
  }
  lastErrors = errors;
  lastFetchedAt = Date.now();
  console.log(
    `[aggregate] refresh 완료: ${lastPrograms.length}건` +
      (errors.length ? ` (실패 소스: ${errors.map((e) => e.source).join(", ")})` : ""),
  );
}

function triggerRefresh(): Promise<void> {
  if (!refreshing) {
    refreshing = refresh()
      .catch((err) => console.error("[aggregate] refresh error:", err))
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** 서버 기동 시 1회 수집 + 주기적 백그라운드 갱신 시작 */
export function startBackgroundRefresh(): Promise<void> {
  const first = (async () => {
    await triggerRefresh();
    // 컨테이너 부팅 직후에는 네트워크가 준비되지 않아 전 소스가 실패할 수 있음 → 짧은 간격 재시도
    for (const delayMs of [10_000, 20_000, 40_000, 60_000]) {
      if (lastPrograms.length > 0) break;
      await new Promise((r) => setTimeout(r, delayMs));
      console.log("[aggregate] 부팅 직후 수집 실패 — 재시도");
      await triggerRefresh();
    }
  })();
  const timer = setInterval(triggerRefresh, REFRESH_INTERVAL_MS);
  timer.unref();
  return first;
}

/**
 * 캐시가 비어 있을 때 스냅샷 소스만 빠르게 로드하는 폴백 경로.
 * KC처럼 유휴 시 CPU가 멈추는(타이머가 돌지 않는) 서버리스 환경에서도
 * 첫 요청이 1~2초 안에 데이터를 확보할 수 있게 한다.
 */
let snapshotLoading: Promise<void> | null = null;

async function loadSnapshotFallback(): Promise<void> {
  if (snapshotLoading) return snapshotLoading;
  snapshotLoading = (async () => {
    const snap = sources.find((s) => s.id === "snapshot");
    if (!snap) return;
    try {
      const programs = await snap.fetchPrograms();
      if (programs.length > 0 && lastPrograms.length === 0) {
        lastPrograms = dedupePrograms(programs);
        sortPrograms(lastPrograms);
        lastFetchedAt = Date.now();
        lastSourceCounts = { snapshot: programs.length };
        console.log(`[aggregate] 스냅샷 폴백 로드: ${lastPrograms.length}건`);
      }
    } catch (err) {
      console.error("[aggregate] 스냅샷 폴백 실패:", err);
    }
  })().finally(() => {
    snapshotLoading = null;
  });
  return snapshotLoading;
}

/**
 * 캐시된 공고 목록 반환. 캐시가 비어 있으면(콜드 스타트 직후) 스냅샷을 우선 로드해 즉시 응답하고,
 * 전체 수집은 백그라운드로 진행한다. 오래된 캐시는 그대로 반환하면서 갱신만 트리거한다.
 */
export async function getAllPrograms(): Promise<{
  programs: SubsidyProgram[];
  errors: { source: string; message: string }[];
  fetchedAt: number;
}> {
  if (lastPrograms.length === 0) {
    await loadSnapshotFallback(); // 빠른 경로 (GitHub raw 1회 호출)
    void triggerRefresh(); // 전체 소스 수집은 백그라운드
  } else if (Date.now() - lastFetchedAt > STALE_MS) {
    void triggerRefresh();
  }
  return { programs: lastPrograms, errors: lastErrors, fetchedAt: lastFetchedAt };
}

/** 운영 진단용 상태 (healthz 노출) */
export function getDiagnostics() {
  return {
    fetchedAt: lastFetchedAt ? new Date(lastFetchedAt).toISOString() : null,
    totalPrograms: lastPrograms.length,
    sourceCounts: lastSourceCounts, // -1 = 조회 실패
    errors: lastErrors,
    env: {
      GOV24_API_KEY: process.env.GOV24_API_KEY ? "set" : "missing",
      BIZINFO_API_KEY: process.env.BIZINFO_API_KEY ? "set" : "missing",
    },
  };
}

/** ID로 단건 조회 */
export async function getProgramById(id: string): Promise<SubsidyProgram | undefined> {
  const { programs } = await getAllPrograms();
  return programs.find((p) => p.id === id);
}
