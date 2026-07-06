import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 프로젝트 루트의 .env를 읽어 process.env에 주입 (이미 설정된 값은 유지) */
export function loadDotEnv(path = ".env"): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), path), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env 없으면 무시
  }
}
