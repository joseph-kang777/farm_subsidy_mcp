/**
 * 기업마당(bizinfo.go.kr) 지원사업정보 API.
 * 스펙: https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi
 * 인증키: 페이지 하단 폼에서 즉시 발급 → 환경변수 BIZINFO_API_KEY
 */
import type { SubsidyProgram } from "../types.js";
import type { SubsidySource } from "../aggregate.js";
import { computeStatus, fetchWithTimeout, parseDateRange, stripHtml } from "../util.js";
import { isAgriRelated } from "./keywords.js";

const ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";

interface BizinfoItem {
  pblancId?: string;
  pblancNm?: string;
  pblancUrl?: string;
  jrsdInsttNm?: string;
  excInsttNm?: string;
  bsnsSumryCn?: string;
  reqstBeginEndDe?: string;
  trgetNm?: string;
  pldirSportRealmLclasCodeNm?: string;
  hashTags?: string;
  creatPnttm?: string;
}

/** 해시태그에서 시·도 지역명 추출 */
function extractRegion(hashTags: string | undefined): string | undefined {
  if (!hashTags) return undefined;
  const REGIONS = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  ];
  const found = REGIONS.filter((r) => hashTags.includes(r));
  if (found.length === 0) return "전국";
  return found.join(", ");
}

function toProgram(item: BizinfoItem): SubsidyProgram | undefined {
  if (!item.pblancId || !item.pblancNm) return undefined;
  const { start, end } = parseDateRange(item.reqstBeginEndDe);
  const url = item.pblancUrl
    ? item.pblancUrl.startsWith("http")
      ? item.pblancUrl
      : `https://www.bizinfo.go.kr${item.pblancUrl}`
    : undefined;
  return {
    id: `bizinfo:${item.pblancId}`,
    source: "bizinfo",
    sourceName: "기업마당",
    title: stripHtml(item.pblancNm),
    organization: item.jrsdInsttNm || item.excInsttNm,
    region: extractRegion(item.hashTags),
    category: item.pldirSportRealmLclasCodeNm,
    supportType: item.pldirSportRealmLclasCodeNm,
    target: stripHtml(item.trgetNm),
    summary: stripHtml(item.bsnsSumryCn),
    applyStart: start,
    applyEnd: end,
    status: computeStatus(start, end),
    url,
    postedAt: item.creatPnttm ? item.creatPnttm.slice(0, 10).replace(/\./g, "-") : undefined,
  };
}

export const bizinfoSource: SubsidySource = {
  id: "bizinfo",
  name: "기업마당 지원사업정보",
  async fetchPrograms(): Promise<SubsidyProgram[]> {
    const key = process.env.BIZINFO_API_KEY;
    if (!key) {
      console.warn("[bizinfo] BIZINFO_API_KEY 미설정 — 소스 건너뜀");
      return [];
    }
    const url = `${ENDPOINT}?crtfcKey=${encodeURIComponent(key)}&dataType=json&searchCnt=500`;
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error(`bizinfo HTTP ${res.status}`);
    const data: any = await res.json();
    // 응답 구조: { jsonArray: [...] } 또는 { item: [...] } 등 변형에 대비
    const items: BizinfoItem[] =
      data?.jsonArray ?? data?.item ?? data?.items ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(items)) throw new Error("bizinfo 응답 형식이 예상과 다름");

    return items
      .map(toProgram)
      .filter((p): p is SubsidyProgram => !!p)
      .filter((p) =>
        isAgriRelated(`${p.title} ${p.summary ?? ""} ${p.organization ?? ""} ${p.target ?? ""}`),
      );
  },
};
