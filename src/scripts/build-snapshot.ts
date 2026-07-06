/**
 * 데이터 스냅샷 생성 스크립트.
 * 정부 소스(농업e지 등)가 특정 네트워크(클라우드/해외 IP)를 차단하므로, 접근 가능한 환경에서
 * 수집한 결과를 data/snapshot.json으로 저장해 저장소에 커밋한다.
 * 서버(KC)는 GitHub raw에서 이 스냅샷을 읽는다.
 *
 * 병합 규칙: 이번 실행에서 수집에 성공한 소스만 새 데이터로 교체하고,
 * 실패(차단)한 소스는 기존 스냅샷의 데이터를 유지한다.
 * (예: GitHub Actions(해외 IP)에서는 농업e지가 차단되므로 기존 농업e지 데이터 유지)
 *
 * 사용법: npm run snapshot   (GOV24_API_KEY 등은 .env 또는 환경변수)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadDotEnv } from "../env.js";
import { bizinfoSource } from "../sources/bizinfo.js";
import { gov24Source } from "../sources/gov24.js";
import { mafraSource } from "../sources/mafra.js";
import { nongupezSource } from "../sources/nongupez.js";
import type { SubsidyProgram } from "../types.js";

loadDotEnv();

const SNAPSHOT_PATH = "data/snapshot.json";
const sources = [nongupezSource, gov24Source, bizinfoSource, mafraSource];

function loadPrevious(): SubsidyProgram[] {
  try {
    const data = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    return Array.isArray(data?.programs) ? data.programs : [];
  } catch {
    return [];
  }
}

async function main() {
  const previous = loadPrevious();
  const fresh: SubsidyProgram[] = [];
  /** 이번 실행에서 1건 이상 수집에 성공한 소스 (0건은 키 미설정/차단 가능성 → 기존 유지) */
  const refreshed = new Set<string>();

  for (const s of sources) {
    try {
      const list = await s.fetchPrograms();
      if (list.length > 0) {
        fresh.push(...list);
        refreshed.add(s.id);
        console.log(`[snapshot] ${s.id}: ${list.length}건 (갱신)`);
      } else {
        console.warn(`[snapshot] ${s.id}: 0건 — 기존 데이터 유지`);
      }
    } catch (err) {
      console.error(`[snapshot] ${s.id} 실패 — 기존 데이터 유지:`, String(err));
    }
  }

  // 갱신 안 된 소스는 기존 스냅샷에서 유지
  const kept = previous.filter((p) => !refreshed.has(p.source));
  if (kept.length > 0) {
    const bySource = kept.reduce<Record<string, number>>((acc, p) => {
      acc[p.source] = (acc[p.source] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[snapshot] 기존 유지:`, JSON.stringify(bySource));
  }

  const merged = [...fresh, ...kept];
  if (merged.length === 0) {
    console.error("[snapshot] 수집 결과가 0건이고 기존 스냅샷도 없음 — 갱신 중단");
    process.exit(1);
  }
  if (refreshed.size === 0) {
    console.warn("[snapshot] 이번 실행에서 갱신된 소스가 없음 — 파일을 다시 쓰지 않음");
    return;
  }

  mkdirSync("data", { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    total: merged.length,
    refreshedSources: [...refreshed],
    programs: merged,
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload), "utf8");
  console.log(`[snapshot] ${SNAPSHOT_PATH} 저장 완료 — 총 ${merged.length}건 (갱신 소스: ${[...refreshed].join(", ")})`);
}

main();
