/**
 * 농업e지(nongupez.go.kr) — 농식품부 농림사업 통합 포털의 사업 검색 API.
 * 인증 불필요. eXBuilder6 submission 형식의 JSON POST.
 * POST /nsm/bizAply/wholeBiz/retrieveListBizSrch
 *   body: { srchCnd: {...}, paging: { curPage, pageSize } }
 *   응답: { bizList: [...], paging: { totalPage(총건수), pageCount(총페이지) } }
 */
import type { SubsidyProgram } from "../types.js";
import type { SubsidySource } from "../aggregate.js";
import { computeStatus, fetchWithTimeout, normalizeDate, stripHtml, todayKST } from "../util.js";

const ENDPOINT = "https://www.nongupez.go.kr/nsm/bizAply/wholeBiz/retrieveListBizSrch";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface NongupezRow {
  afbzCd?: string;
  afbzNm?: string;
  bizYr?: string;
  bizCn?: string;
  bizAplyBgngYmd?: string;
  bizAplyEndYmd?: string;
  bizAtrbDtlNm?: string;
  onlnAplyPsbltyYn?: string;
}

async function fetchPage(bizYr: string, curPage: number): Promise<{ rows: NongupezRow[]; total: number }> {
  const body = JSON.stringify({
    srchCnd: {
      srchKeyword: "",
      srchBizYr: bizYr,
      srchAplyBgngYmd: "",
      srchAplyEndYmd: "",
      srchH: "",
      srchJ1: "",
      srchJ2: "",
      srchA: "",
      srchG: "",
      srchI: "",
      srchBizPbancExstYn: "",
      srchOnlnAplyPsbltyYn: "",
      sortCnd: "A", // 신청마감 순
      srchF2: "",
      srchKeywordCnd: "",
    },
    paging: { curPage, pageSize: PAGE_SIZE },
  });
  const res = await fetchWithTimeout(
    ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Referer: "https://www.nongupez.go.kr/nsm/bizAply/wholeBiz/wholeBizMain",
        "User-Agent": "farm-subsidy-mcp/0.1 (+PlayMCP)",
      },
      body,
    },
    15000,
  );
  if (!res.ok) throw new Error(`nongupez HTTP ${res.status}`);
  const data: any = await res.json();
  if (!Array.isArray(data?.bizList)) throw new Error("nongupez 응답 형식이 예상과 다름");
  // paging.totalPage가 실제로는 총 건수, pageCount가 총 페이지 수
  return { rows: data.bizList, total: Number(data?.paging?.totalPage ?? 0) };
}

function toProgram(row: NongupezRow): SubsidyProgram | undefined {
  if (!row.afbzCd || !row.afbzNm) return undefined;
  const start = normalizeDate(row.bizAplyBgngYmd);
  const end = normalizeDate(row.bizAplyEndYmd);
  return {
    id: `nongupez:${row.afbzCd}:${row.bizYr ?? ""}`,
    source: "nongupez",
    sourceName: "농업e지",
    title: stripHtml(row.afbzNm),
    organization: row.bizAtrbDtlNm ?? "농림축산식품부",
    region: "전국",
    supportType: row.onlnAplyPsbltyYn === "Y" ? "온라인신청 가능" : undefined,
    summary: stripHtml(row.bizCn),
    applyStart: start,
    applyEnd: end,
    status: computeStatus(start, end),
    url: `https://www.nongupez.go.kr/nsm/bizAply/wholeBiz/wholeBizDtls?afbzCd=${encodeURIComponent(row.afbzCd)}&bizYr=${encodeURIComponent(row.bizYr ?? "")}`,
  };
}

export const nongupezSource: SubsidySource = {
  id: "nongupez",
  name: "농업e지 농림사업",
  async fetchPrograms(): Promise<SubsidyProgram[]> {
    const bizYr = todayKST().slice(0, 4);
    const first = await fetchPage(bizYr, 1);
    const rows = [...first.rows];
    const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
    for (let p = 2; p <= pages; p++) {
      const next = await fetchPage(bizYr, p);
      rows.push(...next.rows);
    }
    const programs = rows.map(toProgram).filter((p): p is SubsidyProgram => !!p);
    console.log(`[nongupez] ${programs.length}건 수집 (${bizYr}년)`);
    return programs;
  },
};
