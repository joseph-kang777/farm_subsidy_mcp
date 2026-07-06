/**
 * 데이터 소스 등록 (side-effect 모듈).
 */
import { registerSource } from "../aggregate.js";
import { bizinfoSource } from "./bizinfo.js";
import { gov24Source } from "./gov24.js";
import { mafraSource } from "./mafra.js";
import { nongupezSource } from "./nongupez.js";
import { snapshotSource } from "./snapshot.js";

// 스냅샷을 우선 등록 (라이브 소스가 차단된 환경 대비). 동일 공고는 dedupe로 병합됨.
registerSource(snapshotSource);
registerSource(nongupezSource);
registerSource(gov24Source);
registerSource(bizinfoSource);
registerSource(mafraSource);
