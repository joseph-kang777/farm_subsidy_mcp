/**
 * 농림축산식품부 공지·공고 RSS (인증키 불필요).
 * 공지·공고: https://www.mafra.go.kr/bbs/home/791/rssList.do?row=50
 * 필드가 title/link/pubDate 뿐이므로 제목에서 기간을 추정하고, 상태는 게시일 기준으로 보수적으로 판정.
 */
import type { SubsidyProgram } from "../types.js";
import type { SubsidySource } from "../aggregate.js";
import { computeStatus, fetchWithTimeout, normalizeDate, parseDateRange, stripHtml } from "../util.js";

const FEEDS = [
  { url: "https://www.mafra.go.kr/bbs/home/791/rssList.do?row=50", label: "공지·공고" },
];

interface RssItem {
  title: string;
  link?: string;
  pubDate?: string;
}

/** 의존성 없이 RSS <item> 블록 파싱 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const block of blocks) {
    const tag = (name: string): string | undefined => {
      const m =
        block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`)) ??
        block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? m[1].trim() : undefined;
    };
    const title = tag("title");
    if (!title) continue;
    items.push({ title: stripHtml(title), link: tag("link"), pubDate: tag("pubDate") });
  }
  return items;
}

function parsePubDate(pubDate: string | undefined): string | undefined {
  if (!pubDate) return undefined;
  // "Fri, 03 Jul 2026 09:00:00 +0900" 또는 "2026-07-03" 등
  const iso = normalizeDate(pubDate);
  if (iso) return iso;
  const t = Date.parse(pubDate);
  if (!Number.isNaN(t)) return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return undefined;
}

function toProgram(item: RssItem, index: number): SubsidyProgram {
  const posted = parsePubDate(item.pubDate);
  // 제목에 "(~7.15.)" 등 기간이 있으면 추출 시도
  const { start, end } = parseDateRange(item.title);
  const idBase = item.link?.match(/artclView\.do[^"]*|\/(\d+)\/artclView/) ? item.link : `${posted}-${index}`;
  return {
    id: `mafra:${hashCode(idBase ?? item.title)}`,
    source: "mafra",
    sourceName: "농림축산식품부 공고",
    title: item.title,
    organization: "농림축산식품부",
    region: "전국",
    applyStart: start,
    applyEnd: end,
    status: start || end ? computeStatus(start, end) : "unknown",
    url: item.link,
    postedAt: posted,
  };
}

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export const mafraSource: SubsidySource = {
  id: "mafra",
  name: "농림축산식품부 공지·공고 RSS",
  async fetchPrograms(): Promise<SubsidyProgram[]> {
    const out: SubsidyProgram[] = [];
    for (const feed of FEEDS) {
      const res = await fetchWithTimeout(feed.url, {}, 15000);
      if (!res.ok) throw new Error(`mafra RSS HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      items.forEach((item, i) => {
        // 농식품부 공고는 전부 농업 소관이므로, 보조·지원·공모 성격 공고만 선별
        const isSupportNotice = /지원|보조|공모|모집|신청|사업/.test(item.title);
        if (isSupportNotice) out.push(toProgram(item, i));
      });
    }
    return out;
  },
};
