/** 농업 관련 공고 판별용 키워드 (제목/개요/기관명 대상) */
export const AGRI_KEYWORDS = [
  "농업",
  "농촌",
  "농가",
  "농민",
  "농지",
  "농기계",
  "농산물",
  "농식품",
  "농림",
  "귀농",
  "영농",
  "축산",
  "낙농",
  "양봉",
  "원예",
  "과수",
  "시설원예",
  "스마트팜",
  "스마트농업",
  "친환경농",
  "임업",
  "산림소득",
  "농어업",
  "농어촌",
  "후계농",
  "청년농",
  "여성농",
];

/** 농업 소관 기관 판별용 키워드 */
export const AGRI_ORGS = [
  "농림축산식품부",
  "농촌진흥청",
  "산림청",
  "농업기술원",
  "농업기술센터",
  "농업정책보험금융원",
  "농림수산식품교육문화정보원",
  "축산물품질평가원",
  "농업진흥청",
];

export function isAgriRelated(text: string): boolean {
  return AGRI_KEYWORDS.some((kw) => text.includes(kw)) || AGRI_ORGS.some((o) => text.includes(o));
}
