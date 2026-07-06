/**
 * 데이터 소스 등록 (side-effect 모듈).
 */
import { registerSource } from "../aggregate.js";
import { bizinfoSource } from "./bizinfo.js";
import { gov24Source } from "./gov24.js";
import { mafraSource } from "./mafra.js";
import { nongupezSource } from "./nongupez.js";

registerSource(nongupezSource);
registerSource(gov24Source);
registerSource(bizinfoSource);
registerSource(mafraSource);
