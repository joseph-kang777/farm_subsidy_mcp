/**
 * 스모크 테스트: 로컬 서버(:8080)에 MCP 클라이언트로 접속해
 * tools/list와 주요 tool 호출이 정상 동작하는지 확인한다.
 *
 * 사용법: 서버를 띄운 뒤(npm run dev)  npm test
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.MCP_URL ?? "http://localhost:8080/mcp";

function firstText(result: any): string {
  const t = result?.content?.find((c: any) => c.type === "text")?.text ?? "";
  return String(t);
}

async function main() {
  const client = new Client({ name: "smoke-test", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(BASE));
  await client.connect(transport);
  console.log("✔ connected");

  const { tools } = await client.listTools();
  console.log(`✔ tools/list: ${tools.length}개 —`, tools.map((t) => t.name).join(", "));
  if (tools.length < 5) throw new Error("도구 개수가 예상보다 적음");

  // 1) 검색
  const search = await client.callTool({
    name: "search_farm_subsidies",
    arguments: { keyword: "농업", status: "all", limit: 5 },
  });
  const searchText = firstText(search);
  console.log("\n--- search_farm_subsidies ---\n" + searchText.slice(0, 800));
  if (!searchText.includes("검색 결과")) throw new Error("검색 응답 형식 이상");

  // 검색 결과에서 ID 하나 추출 (마크다운: - **ID**: `bizinfo:...`)
  const idMatch = searchText.match(/`(\w+:[^`]+)`/);

  // 2) 상세
  if (idMatch) {
    const detail = await client.callTool({
      name: "get_subsidy_detail",
      arguments: { id: idMatch[1] },
    });
    console.log("\n--- get_subsidy_detail ---\n" + firstText(detail).slice(0, 600));
  } else {
    console.warn("⚠ 검색 결과에 ID가 없어 상세 조회 생략");
  }

  // 3) 마감 임박
  const closing = await client.callTool({
    name: "get_closing_soon_subsidies",
    arguments: { withinDays: 30, limit: 5 },
  });
  console.log("\n--- get_closing_soon_subsidies ---\n" + firstText(closing).slice(0, 600));

  // 4) 접수 예정
  const upcoming = await client.callTool({
    name: "get_upcoming_subsidies",
    arguments: { limit: 5 },
  });
  console.log("\n--- get_upcoming_subsidies ---\n" + firstText(upcoming).slice(0, 600));

  // 5) 브리핑
  const briefing = await client.callTool({ name: "get_daily_briefing", arguments: {} });
  console.log("\n--- get_daily_briefing ---\n" + firstText(briefing).slice(0, 800));

  // 6) 캘린더 이벤트
  if (idMatch) {
    const cal = await client.callTool({
      name: "build_calendar_events",
      arguments: { ids: [idMatch[1]], eventType: "both" },
    });
    const calText = firstText(cal);
    console.log("\n--- build_calendar_events ---\n" + calText.slice(0, 800));
  }

  await client.close();
  console.log("\n✅ 스모크 테스트 통과");
}

main().catch((err) => {
  console.error("❌ 스모크 테스트 실패:", err);
  process.exit(1);
});
