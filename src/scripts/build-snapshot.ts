/**
 * 데이터 스냅샷 생성 스크립트.
 * 정부 소스(농업e지 등)가 클라우드 IP를 차단하므로, 접근 가능한 환경(로컬/CI)에서
 * 수집한 결과를 data/snapshot.json으로 저장해 저장소에 커밋한다.
 * 서버(KC)는 GitHub raw에서 이 스냅샷을 읽는다.
 *
 * 사용법: npm run snapshot   (GOV24_API_KEY 등은 .env 또는 환경변수)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadDotEnv } from "../env.js";
import { bizinfoSource } from "../sources/bizinfo.js";
import { gov24Source } from "../sources/gov24.js";
import { mafraSource } from "../sources/mafra.js";
import { nongupezSource } from "../sources/nongupez.js";
import type { SubsidyProgram } from "../types.js";

loadDotEnv();

const sources = [nongupezSource, gov24Source, bizinfoSource, mafraSource];

async function main() {
  const programs: SubsidyProgram[] = [];
  let failed = 0;
  for (const s of sources) {
    try {
      const list = await s.fetchPrograms();
      console.log(`[snapshot] ${s.id}: ${list.length}건`);
      programs.push(...list);
    } catch (err) {
      failed++;
      console.error(`[snapshot] ${s.id} 실패:`, err);
    }
  }
  if (programs.length === 0) {
    console.error("[snapshot] 수집 결과가 0건 — 스냅샷을 갱신하지 않음");
    process.exit(1);
  }
  mkdirSync("data", { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    total: programs.length,
    failedSources: failed,
    programs,
  };
  writeFileSync("data/snapshot.json", JSON.stringify(payload), "utf8");
  console.log(`[snapshot] data/snapshot.json 저장 완료 — 총 ${programs.length}건`);
}

main();
