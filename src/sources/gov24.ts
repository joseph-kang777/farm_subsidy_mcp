/**
 * 보조금24 — 행정안전부 대한민국 공공서비스(혜택) 정보 API (api.odcloud.kr/api/gov24/v3).
 * 문서: https://www.data.go.kr/data/15113968/openapi.do
 * 인증키: 공공데이터포털(data.go.kr) 활용신청 시 자동승인 → 환경변수 GOV24_API_KEY (일반 인증키 Decoding 값)
 */
import type { SubsidyProgram } from "../types.js";
import type { SubsidySource } from "../aggregate.js";
import { computeStatus, fetchWithTimeout, parseDateRange, stripHtml } from "../util.js";
import { isAgriRelated } from "./keywords.js";

const BASE = "https://api.odcloud.kr/api/gov24/v3/serviceList";
const PER_PAGE = 500;
const MAX_PAGES = 6;

/** 응답 레코드에서 후보 키 중 존재하는 값을 반환 (컬럼명이 한글/영문 변형 가능성 대비) */
function pick(rec: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

function toProgram(rec: Record<string, any>): SubsidyProgram | undefined {
  const id = pick(rec, "서비스ID", "serviceId", "svcId");
  const title = pick(rec, "서비스명", "serviceName", "svcNm");
  if (!id || !title) return undefined;

  const applyPeriod = pick(rec, "신청기한", "applyPeriod");
  const { start, end } = parseDateRange(applyPeriod);
  // "상시" 신청은 마감 없음 → open으로 취급
  const isAlways = applyPeriod ? /상시|연중/.test(applyPeriod) : false;
  const status = isAlways ? "open" : computeStatus(start, end);

  return {
    id: `gov24:${id}`,
    source: "gov24",
    sourceName: "보조금24",
    title: stripHtml(title),
    organization: pick(rec, "소관기관명", "부서명", "접수기관명"),
    region: pick(rec, "지원지역") ?? inferRegionFromOrg(pick(rec, "소관기관명")),
    category: pick(rec, "서비스분야"),
    supportType: pick(rec, "지원유형"),
    target: stripHtml(pick(rec, "지원대상")),
    summary: stripHtml(
      [pick(rec, "서비스목적요약", "서비스목적"), pick(rec, "지원내용")]
        .filter(Boolean)
        .join("\n"),
    ),
    applyStart: start,
    applyEnd: isAlways ? undefined : end,
    status,
    url:
      pick(rec, "상세조회URL") ??
      `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${encodeURIComponent(id)}`,
    postedAt: pick(rec, "등록일시", "수정일시")?.slice(0, 10),
  };
}

/** 소관기관명에서 광역 지자체명 추정 (예: "전북특별자치도 김제시" → "전북") */
function inferRegionFromOrg(org: string | undefined): string | undefined {
  if (!org) return undefined;
  const MAP: [RegExp, string][] = [
    [/서울/, "서울"], [/부산/, "부산"], [/대구/, "대구"], [/인천/, "인천"],
    [/광주/, "광주"], [/대전/, "대전"], [/울산/, "울산"], [/세종/, "세종"],
    [/경기/, "경기"], [/강원/, "강원"], [/충청북도|충북/, "충북"], [/충청남도|충남/, "충남"],
    [/전라북도|전북/, "전북"], [/전라남도|전남/, "전남"], [/경상북도|경북/, "경북"],
    [/경상남도|경남/, "경남"], [/제주/, "제주"],
  ];
  for (const [re, name] of MAP) if (re.test(org)) return name;
  return "전국";
}

async function fetchPage(key: string, page: number, cond: string): Promise<any> {
  const url =
    `${BASE}?page=${page}&perPage=${PER_PAGE}&returnType=JSON${cond}` +
    `&serviceKey=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`gov24 HTTP ${res.status}`);
  return res.json();
}

export const gov24Source: SubsidySource = {
  id: "gov24",
  name: "보조금24 공공서비스",
  async fetchPrograms(): Promise<SubsidyProgram[]> {
    const key = process.env.GOV24_API_KEY;
    if (!key) {
      console.warn("[gov24] GOV24_API_KEY 미설정 — 소스 건너뜀");
      return [];
    }

    // 1차: 서버측 분야 필터(농림축산) 시도, 실패/0건이면 전체 페이지 순회 후 클라이언트 필터
    const condFiltered = `&${encodeURIComponent("cond[서비스분야::LIKE]")}=${encodeURIComponent("농림")}`;
    let records: Record<string, any>[] = [];
    let usedServerFilter = true;
    try {
      const first = await fetchPage(key, 1, condFiltered);
      const total = Number(first?.totalCount ?? 0);
      records = first?.data ?? [];
      if (total > records.length) {
        const pages = Math.min(Math.ceil(total / PER_PAGE), MAX_PAGES);
        for (let p = 2; p <= pages; p++) {
          const next = await fetchPage(key, p, condFiltered);
          records.push(...(next?.data ?? []));
        }
      }
      if (records.length === 0) usedServerFilter = false;
    } catch {
      usedServerFilter = false;
    }

    if (!usedServerFilter) {
      records = [];
      for (let p = 1; p <= MAX_PAGES; p++) {
        const resp = await fetchPage(key, p, "");
        const data = resp?.data ?? [];
        records.push(...data);
        if (data.length < PER_PAGE) break;
      }
    }

    const programs = records
      .map(toProgram)
      .filter((p): p is SubsidyProgram => !!p)
      .filter((p) =>
        usedServerFilter
          ? true
          : isAgriRelated(`${p.title} ${p.category ?? ""} ${p.summary ?? ""} ${p.organization ?? ""}`),
      );
    console.log(`[gov24] ${programs.length}건 수집 (서버필터=${usedServerFilter})`);
    return programs;
  },
};
