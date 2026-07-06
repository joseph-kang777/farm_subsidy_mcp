import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAllPrograms, getProgramById } from "./aggregate.js";
import type { CalendarEventPayload, SubsidyProgram } from "./types.js";
import { applyFilters, daysUntil, todayKST, toKstIso } from "./util.js";
import "./sources/register.js"; // 소스 등록 (side effect)

const SERVICE = "FarmSubsidy Korea(농업보조금 알리미)";
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;
/** PlayMCP 응답 24KB 제한 대비 여유를 둔 캡 */
const MAX_RESPONSE_BYTES = 20 * 1024;

/** 모든 도구가 읽기 전용 조회이므로 annotations 공통값 (PlayMCP 필수 항목 전부 지정) */
function annotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

const STATUS_LABEL: Record<string, string> = {
  open: "접수중",
  upcoming: "접수예정",
  closed: "마감",
  unknown: "상시/미정",
};

function formatProgram(p: SubsidyProgram, opts: { detail?: boolean } = {}): string {
  const lines: string[] = [];
  const dday =
    p.applyEnd && p.status === "open" ? ` (D-${Math.max(0, daysUntil(p.applyEnd))})` : "";
  lines.push(`### ${p.title}`);
  lines.push(`- **ID**: \`${p.id}\``);
  lines.push(`- **상태**: ${STATUS_LABEL[p.status]}${dday}`);
  if (p.organization) lines.push(`- **기관**: ${p.organization}`);
  if (p.region) lines.push(`- **지역**: ${p.region}`);
  if (p.applyStart || p.applyEnd)
    lines.push(`- **접수기간**: ${p.applyStart ?? "?"} ~ ${p.applyEnd ?? "상시/미정"}`);
  if (p.supportType) lines.push(`- **지원형태**: ${p.supportType}`);
  if (opts.detail) {
    if (p.target) lines.push(`- **지원대상**: ${p.target}`);
    if (p.summary) lines.push(`- **개요**: ${p.summary.slice(0, 1200)}`);
  } else if (p.summary) {
    lines.push(`- **개요**: ${p.summary.slice(0, 150)}${p.summary.length > 150 ? "…" : ""}`);
  }
  if (p.url) lines.push(`- **링크**: ${p.url}`);
  lines.push(`- **출처**: ${p.sourceName}`);
  return lines.join("\n");
}

/** UTF-8 바이트 기준으로 잘라 24KB 제한을 지킨다 */
function capBytes(text: string): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= MAX_RESPONSE_BYTES) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(text.slice(0, mid)).length <= MAX_RESPONSE_BYTES - 50) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "\n\n…(응답 크기 제한으로 일부 생략)";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: capBytes(text) }] };
}

function listResponse(programs: SubsidyProgram[], header: string, limit: number) {
  const shown = programs.slice(0, limit);
  const body =
    shown.length === 0
      ? "조건에 맞는 공고가 없습니다. 키워드를 바꾸거나 status를 'all'로 조회해 보세요."
      : shown.map((p) => formatProgram(p)).join("\n\n");
  const more =
    programs.length > shown.length
      ? `\n\n_(총 ${programs.length}건 중 ${shown.length}건 표시 — limit을 늘리거나 키워드로 좁혀 보세요)_`
      : `\n\n_(총 ${shown.length}건)_`;
  return textResult(`${header}\n\n기준일: ${todayKST()} (KST)\n\n${body}${more}`);
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function errorNote(errors: { source: string }[], totalPrograms: number): string {
  // 스냅샷 등 다른 소스로 데이터가 확보됐으면 개별 소스 실패는 사용자에게 노출하지 않음
  if (totalPrograms > 0 || errors.length === 0) return "";
  return `\n> ⚠ 일부 소스 조회 실패: ${errors.map((e) => e.source).join(", ")}`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "farm-subsidy-kr",
    version: "0.1.0",
  });

  server.registerTool(
    "search_farm_subsidies",
    {
      title: "농업 보조금·지원사업 검색",
      description:
        "Search Korean agricultural subsidy and support programs (보조금·지원금) aggregated from government sources " +
        "(Bojogeum24, Bizinfo, MAFRA) by keyword, region, and application status. " +
        "Returns program name, application period, D-day, target, and detail link. " +
        `Use for questions like '스마트팜 지원사업 찾아줘', '전북 농업 보조금 알려줘'. From ${SERVICE}.`,
      annotations: annotations("농업 보조금·지원사업 검색"),
      inputSchema: {
        keyword: z
          .string()
          .optional()
          .describe("검색 키워드 (예: '스마트팜', '귀농', '농기계'). 공백 구분 시 AND 검색"),
        region: z
          .string()
          .optional()
          .describe("지역 필터 — 시·도명 (예: '전북', '경기'). 전국 단위 공고는 항상 포함"),
        status: z
          .enum(["open", "upcoming", "closed", "all"])
          .optional()
          .describe("접수 상태: open(접수중)/upcoming(접수예정)/closed(마감)/all(전체). 기본 open"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`최대 반환 건수 (기본 ${DEFAULT_LIMIT}, 최대 ${MAX_LIMIT})`),
      },
    },
    async ({ keyword, region, status, limit }) => {
      const { programs, errors } = await getAllPrograms();
      const filtered = applyFilters(programs, { keyword, region, status: status ?? "open" });
      const header =
        `## 🌾 농업 보조금·지원사업 검색 결과` +
        (keyword ? ` — "${keyword}"` : "") +
        (region ? ` / ${region}` : "") +
        ` / ${STATUS_LABEL[status ?? "open"] ?? "전체"}` +
        errorNote(errors, programs.length);
      return listResponse(filtered, header, clampLimit(limit));
    },
  );

  server.registerTool(
    "get_subsidy_detail",
    {
      title: "보조금 상세 조회",
      description:
        "Get full details (target, benefits, application period, apply link) of a subsidy program by its ID. " +
        `IDs are returned by other tools of ${SERVICE}, e.g. 'bizinfo:PBLN_000000000099999'.`,
      annotations: annotations("보조금 상세 조회"),
      inputSchema: {
        id: z.string().describe("보조금 ID (다른 도구 결과의 ID 필드)"),
      },
    },
    async ({ id }) => {
      const program = await getProgramById(id);
      if (!program) {
        return textResult(
          `ID \`${id}\`에 해당하는 공고를 찾지 못했습니다. search_farm_subsidies로 다시 검색해 주세요.`,
        );
      }
      return textResult(formatProgram(program, { detail: true }));
    },
  );

  server.registerTool(
    "get_closing_soon_subsidies",
    {
      title: "마감 임박 보조금 조회",
      description:
        "List agricultural subsidy programs whose application deadline is within N days, sorted by deadline. " +
        `Use for '이번 주 마감 보조금', '놓치면 안 되는 지원사업'. From ${SERVICE}.`,
      annotations: annotations("마감 임박 보조금 조회"),
      inputSchema: {
        withinDays: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("며칠 이내 마감 공고를 볼지 (기본 14일)"),
        region: z.string().optional().describe("지역 필터 (시·도명)"),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    async ({ withinDays, region, limit }) => {
      const days = withinDays ?? 14;
      const { programs, errors } = await getAllPrograms();
      const filtered = applyFilters(programs, { region, status: "open" }).filter(
        (p) => p.applyEnd && daysUntil(p.applyEnd) >= 0 && daysUntil(p.applyEnd) <= days,
      );
      const header =
        `## ⏰ ${days}일 이내 마감 농업 보조금·지원사업` +
        (region ? ` (${region})` : "") +
        errorNote(errors, programs.length);
      return listResponse(filtered, header, clampLimit(limit));
    },
  );

  server.registerTool(
    "get_upcoming_subsidies",
    {
      title: "접수 예정 보조금 조회",
      description:
        "List agricultural subsidy programs whose application has not opened yet (접수 예정), sorted by opening date. " +
        "Combine with build_calendar_events to register opening-day reminders in a calendar. " +
        `From ${SERVICE}.`,
      annotations: annotations("접수 예정 보조금 조회"),
      inputSchema: {
        region: z.string().optional().describe("지역 필터 (시·도명)"),
        keyword: z.string().optional().describe("검색 키워드"),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    async ({ region, keyword, limit }) => {
      const { programs, errors } = await getAllPrograms();
      const filtered = applyFilters(programs, { keyword, region, status: "upcoming" }).sort(
        (a, b) => (a.applyStart ?? "9999").localeCompare(b.applyStart ?? "9999"),
      );
      const header =
        `## 📅 접수 예정 농업 보조금·지원사업` + (region ? ` (${region})` : "") + errorNote(errors, programs.length);
      return listResponse(filtered, header, clampLimit(limit));
    },
  );

  server.registerTool(
    "get_daily_briefing",
    {
      title: "농업 보조금 데일리 브리핑",
      description:
        "Daily briefing of Korean agricultural subsidies: new postings (last 3 days), deadlines within 7 days, " +
        `and upcoming programs, in one summary. Use for '오늘의 보조금 소식', '보조금 브리핑'. From ${SERVICE}.`,
      annotations: annotations("농업 보조금 데일리 브리핑"),
      inputSchema: {
        region: z.string().optional().describe("지역 필터 (시·도명)"),
      },
    },
    async ({ region }) => {
      const { programs, errors } = await getAllPrograms();
      const inRegion = applyFilters(programs, { region, status: "all" });
      const today = todayKST();

      const fresh = inRegion.filter(
        (p) => p.postedAt && daysUntil(p.postedAt) >= -3 && p.status !== "closed",
      );
      const closing = inRegion.filter(
        (p) =>
          p.status === "open" && p.applyEnd && daysUntil(p.applyEnd) >= 0 && daysUntil(p.applyEnd) <= 7,
      );
      const upcoming = inRegion
        .filter((p) => p.status === "upcoming")
        .sort((a, b) => (a.applyStart ?? "9999").localeCompare(b.applyStart ?? "9999"));

      const section = (items: SubsidyProgram[], max: number) =>
        items.length === 0
          ? "_해당 없음_"
          : items.slice(0, max).map((p) => formatProgram(p)).join("\n\n");

      const text =
        `# 🌾 농업 보조금 브리핑 — ${today}${region ? ` / ${region}` : ""}` +
        errorNote(errors, programs.length) +
        `\n\n## ① 최근 3일 신규 공고 (${fresh.length}건)\n${section(fresh, 5)}` +
        `\n\n## ② 7일 이내 마감 임박 (${closing.length}건)\n${section(closing, 5)}` +
        `\n\n## ③ 접수 예정 (${upcoming.length}건)\n${section(upcoming, 5)}` +
        `\n\n> 💡 마감을 놓치고 싶지 않다면 build_calendar_events 도구로 일정 데이터를 만들어 톡캘린더에 등록할 수 있습니다.`;

      return textResult(text);
    },
  );

  server.registerTool(
    "build_calendar_events",
    {
      title: "보조금 일정 캘린더 이벤트 생성",
      description:
        "Convert subsidy application deadlines/opening dates into calendar event payloads " +
        "(title, time{startAt,endAt,allDay,timeZone}, description, reminders in minutes) ready to pass to a " +
        "calendar tool such as TalkCalendar's CreateEvent. Use when the user asks to register subsidy deadlines " +
        `or set reminders, e.g. '보조금 마감일 캘린더에 등록해줘'. From ${SERVICE}.`,
      annotations: annotations("보조금 일정 캘린더 이벤트 생성"),
      inputSchema: {
        ids: z.array(z.string()).min(1).max(20).describe("보조금 ID 목록 (검색 결과의 ID)"),
        eventType: z
          .enum(["deadline", "opening", "both"])
          .optional()
          .describe("deadline: 접수 마감일 / opening: 접수 시작일 / both: 둘 다 (기본 deadline)"),
      },
    },
    async ({ ids, eventType }) => {
      const type = eventType ?? "deadline";
      const events: CalendarEventPayload[] = [];
      const skipped: string[] = [];

      for (const id of ids) {
        const p = await getProgramById(id);
        if (!p) {
          skipped.push(`${id} (공고를 찾지 못함)`);
          continue;
        }
        const desc =
          `${p.summary?.slice(0, 250) ?? ""}\n` +
          (p.target ? `지원대상: ${p.target.slice(0, 150)}\n` : "") +
          (p.url ? `상세: ${p.url}` : "");

        if ((type === "deadline" || type === "both") && p.applyEnd) {
          events.push({
            title: `[접수마감] ${p.title}`,
            time: {
              startAt: toKstIso(p.applyEnd, "09:00:00"),
              endAt: toKstIso(p.applyEnd, "18:00:00"),
              allDay: false,
              timeZone: "Asia/Seoul",
            },
            description: `⏰ 접수 마감일입니다.\n${desc}`.trim(),
            reminders: [1440, 10080], // 1일 전, 7일 전
            subsidyId: p.id,
          });
        }
        if ((type === "opening" || type === "both") && p.applyStart) {
          events.push({
            title: `[접수시작] ${p.title}`,
            time: {
              startAt: toKstIso(p.applyStart, "09:00:00"),
              endAt: toKstIso(p.applyStart, "10:00:00"),
              allDay: false,
              timeZone: "Asia/Seoul",
            },
            description: `📢 접수가 시작되는 날입니다.\n${desc}`.trim(),
            reminders: [1440], // 1일 전
            subsidyId: p.id,
          });
        }
        if (!p.applyEnd && !p.applyStart) skipped.push(`${id} (접수 일정 정보 없음)`);
      }

      const text =
        `## 📅 캘린더 일정 데이터 ${events.length}건 생성\n\n` +
        `아래 events 배열 각 항목을 캘린더 일정 생성 도구(예: 톡캘린더 CreateEvent)에 전달해 등록하세요. ` +
        `등록 전 제목/시작/종료를 사용자에게 요약해 확인받는 것이 좋습니다.\n` +
        (skipped.length ? `\n제외됨: ${skipped.join(", ")}\n` : "") +
        "\n```json\n" +
        JSON.stringify({ events }, null, 2) +
        "\n```";

      return textResult(text);
    },
  );

  return server;
}
