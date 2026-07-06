/**
 * GitHub 저장소에 커밋된 데이터 스냅샷(data/snapshot.json)을 읽는 소스.
 * 정부 사이트가 클라우드 IP를 차단하는 환경(카카오클라우드)에서의 기본 데이터 공급원.
 * 상태(접수중/마감 등)는 스냅샷 생성 시점이 아니라 조회 시점 날짜로 재계산한다.
 */
import type { SubsidyProgram } from "../types.js";
import type { SubsidySource } from "../aggregate.js";
import { computeStatus, fetchWithTimeout } from "../util.js";

const DEFAULT_URL =
  "https://raw.githubusercontent.com/joseph-kang777/farm_subsidy_mcp/main/data/snapshot.json";

export const snapshotSource: SubsidySource = {
  id: "snapshot",
  name: "데이터 스냅샷(GitHub)",
  async fetchPrograms(): Promise<SubsidyProgram[]> {
    const url = process.env.SNAPSHOT_URL ?? DEFAULT_URL;
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
    const data: any = await res.json();
    if (!Array.isArray(data?.programs)) throw new Error("snapshot 형식이 예상과 다름");
    console.log(`[snapshot] ${data.programs.length}건 로드 (generatedAt: ${data.generatedAt})`);
    return (data.programs as SubsidyProgram[]).map((p) => ({
      ...p,
      // 접수 상태는 오늘 날짜 기준으로 재계산 (스냅샷 노후화 대비)
      status: p.applyStart || p.applyEnd ? computeStatus(p.applyStart, p.applyEnd) : p.status,
    }));
  },
};
