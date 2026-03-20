import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { gameSessions, storyEntries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Stats = {
  hp: number; maxHp: number; strength: number;
  cunning: number; will: number; reputation: number;
};
type StatChanges = { hp?: number; strength?: number; cunning?: number; will?: number; reputation?: number };
type DiceOutcome = "critical_failure" | "failure" | "partial" | "success" | "critical_success";
type RollResult = { raw: number; stat: string; statValue: number; modifier: number; total: number; outcome: DiceOutcome };

type Skill = {
  id: string; name: string; nameKo: string;
  description: string; descriptionKo: string;
  statBonus: keyof Omit<Stats, "hp" | "maxHp">;
  bonusValue: number; hpEffect?: number;
  cooldown: number; currentCooldown: number;
};

type Enemy = { name: string; hp: number; maxHp: number; attack: number; defense: number };

// ─── In-memory state ──────────────────────────────────────────────────────────

const statsMap    = new Map<number, Stats>();
const enemyMap    = new Map<number, Enemy | null>();
const playerMetas = new Map<number, { name: string; characterClass: string; skills: Skill[] }>();

// ─── Skills per class ─────────────────────────────────────────────────────────

const CLASS_SKILLS: Record<string, Skill[]> = {
  Warrior: [
    { id: "battle_cry",      name: "Battle Cry",      nameKo: "전투의 함성",  description: "A fearsome war cry that channels your battle fury into raw power.",      descriptionKo: "두려움을 불러일으키는 전쟁의 함성으로 전투 분노를 원초적 힘으로 전환한다.",  statBonus: "strength",   bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "berserker_rage",  name: "Berserker Rage",  nameKo: "광전사의 분노", description: "Abandon all defense and unleash devastating strikes. Pain fuels your rage.", descriptionKo: "모든 방어를 포기하고 파괴적인 일격을 가한다. 고통이 분노를 부채질한다.", statBonus: "strength",   bonusValue: 4, hpEffect: -8, cooldown: 3, currentCooldown: 0 },
  ],
  Rogue: [
    { id: "shadow_strike",   name: "Shadow Strike",   nameKo: "그림자 일격",   description: "Melt into shadow and strike from an unseen angle.",                        descriptionKo: "그림자 속으로 사라져 보이지 않는 각도에서 공격한다.",                    statBonus: "cunning",    bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "smoke_bomb",      name: "Smoke Bomb",      nameKo: "연막탄",        description: "Throw a smoke bomb to vanish, reposition, and gain an edge.",              descriptionKo: "연막탄을 던져 사라지고, 위치를 바꾸고, 우위를 점한다.",                  statBonus: "cunning",    bonusValue: 2, cooldown: 2, currentCooldown: 0 },
  ],
  Mage: [
    { id: "arcane_surge",    name: "Arcane Surge",    nameKo: "비전 쇄도",     description: "Channel raw magical energy to amplify the power of your next spell.",      descriptionKo: "원초적 마법 에너지를 모아 다음 주문의 위력을 증폭시킨다.",              statBonus: "will",       bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "mana_shield",     name: "Mana Shield",     nameKo: "마나 방어막",    description: "Wrap yourself in arcane energy. It hurts — but it protects.",             descriptionKo: "비전 에너지로 자신을 감싼다. 아프지만 보호해준다.",                      statBonus: "will",       bonusValue: 2, hpEffect: 8, cooldown: 3, currentCooldown: 0 },
  ],
  Paladin: [
    { id: "holy_strike",     name: "Holy Strike",     nameKo: "성스러운 일격",  description: "Channel divine light through your weapon for a consecrated blow.",         descriptionKo: "무기를 통해 신성한 빛을 흘려보내 성결된 일격을 가한다.",                statBonus: "will",       bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "lay_on_hands",    name: "Lay on Hands",    nameKo: "안수",          description: "Channel holy energy to heal your wounds through sheer faith.",              descriptionKo: "순수한 신앙으로 성스러운 에너지를 모아 상처를 치유한다.",                statBonus: "will",       bonusValue: 1, hpEffect: 20, cooldown: 4, currentCooldown: 0 },
  ],
  Ranger: [
    { id: "precision_shot",  name: "Precision Shot",  nameKo: "정밀 사격",     description: "Take careful aim, reading the wind, the distance, and your prey.",         descriptionKo: "바람과 거리, 그리고 먹잇감을 읽으며 신중하게 조준한다.",                statBonus: "cunning",    bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "beast_bond",      name: "Beast Bond",      nameKo: "야수의 유대",    description: "Attune with the wild — your instincts sharpen to an animal edge.",         descriptionKo: "야생과 교감한다 — 본능이 동물적 예리함으로 날카로워진다.",             statBonus: "cunning",    bonusValue: 2, cooldown: 2, currentCooldown: 0 },
  ],
  Necromancer: [
    { id: "soul_drain",      name: "Soul Drain",      nameKo: "영혼 흡수",     description: "Siphon life force from your target, healing yourself as you drain them.",   descriptionKo: "대상에서 생명력을 빨아들여 흡수하면서 자신을 치유한다.",                statBonus: "will",       bonusValue: 3, hpEffect: 12, cooldown: 4, currentCooldown: 0 },
    { id: "deaths_embrace",  name: "Death's Embrace", nameKo: "죽음의 포옹",   description: "Embrace death's power directly — reality bends at your command.",          descriptionKo: "죽음의 힘을 직접 받아들인다 — 현실이 당신의 명령에 굴복한다.",         statBonus: "will",       bonusValue: 4, cooldown: 3, currentCooldown: 0 },
  ],
  Bard: [
    { id: "dissonant_whisper", name: "Dissonant Whisper", nameKo: "불협화음", description: "A haunting melody that rattles the mind and reputation precedes you.",       descriptionKo: "마음을 흔드는 선율과 함께 당신의 명성이 앞서 울린다.",                  statBonus: "reputation", bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "healing_word",    name: "Healing Word",    nameKo: "치유의 말",     description: "Speak words of power that mend flesh and soothe pain.",                    descriptionKo: "살을 치유하고 고통을 달래는 힘의 말을 전한다.",                          statBonus: "reputation", bonusValue: 1, hpEffect: 15, cooldown: 3, currentCooldown: 0 },
  ],
  Druid: [
    { id: "natures_wrath",   name: "Nature's Wrath",  nameKo: "자연의 분노",   description: "Unleash the primal fury of the wild upon your enemies.",                   descriptionKo: "야생의 원초적 분노를 적들에게 해방시킨다.",                              statBonus: "will",       bonusValue: 3, cooldown: 3, currentCooldown: 0 },
    { id: "regrowth",        name: "Regrowth",        nameKo: "재생",          description: "Channel natural life force to rapidly regenerate your body.",               descriptionKo: "자연의 생명력을 모아 몸을 빠르게 재생시킨다.",                           statBonus: "will",       bonusValue: 1, hpEffect: 22, cooldown: 4, currentCooldown: 0 },
  ],
};

// Korean class aliases → same skills
const KO_TO_EN: Record<string, string> = {
  전사: "Warrior", 도적: "Rogue", 마법사: "Mage", 성기사: "Paladin",
  레인저: "Ranger", 사령술사: "Necromancer", 음유시인: "Bard", 드루이드: "Druid",
};

function getClassSkills(characterClass: string): Skill[] {
  const en = KO_TO_EN[characterClass] ?? characterClass;
  return (CLASS_SKILLS[en] ?? []).map(s => ({ ...s }));
}

// ─── Dice system ──────────────────────────────────────────────────────────────

function rollD20(): number { return Math.floor(Math.random() * 20) + 1; }
function statModifier(v: number): number { return Math.floor((v - 5) / 2); }
function outcomeFromTotal(t: number): DiceOutcome {
  if (t <= 1)  return "critical_failure";
  if (t <= 6)  return "failure";
  if (t <= 13) return "partial";
  if (t <= 19) return "success";
  return "critical_success";
}

const STRENGTH_KEYWORDS   = ["fight","attack","strike","force","push","break","charge","combat","hit","bash","block","shield","smash","punch","kick","rush","assault","wrestle","overpower","싸우","공격","강제","밀어","부수","돌격","전투","막아","방패","때려","강행","베어","찔러","쳐"];
const CUNNING_KEYWORDS    = ["sneak","hide","steal","lie","deceive","trick","persuade","pick","unlock","shadow","escape","bluff","slip","conceal","distract","bribe","forge","impersonate","infiltrate","숨어","훔쳐","속여","기만","설득","자물쇠","탈출","위장","침투","뇌물","분산","피해"];
const WILL_KEYWORDS       = ["cast","magic","spell","resist","endure","focus","meditate","channel","banish","summon","enchant","curse","ritual","ward","sense","probe","mind","psychic","willpower","arcane","주문","마법","시전","저항","견뎌","집중","명상","소환","봉인","정신","의지","영적","시전"];
const REPUTATION_KEYWORDS = ["speak","negotiate","command","lead","inspire","threaten","appeal","rally","convince","authority","presence","reputation","name","fame","dignity","honor","barter","demand","말해","협상","지휘","이끌","고무","위협","호소","권위","명성","존엄","설득"];

function detectStat(choice: string, stats: Stats): { stat: keyof Omit<Stats, "hp"|"maxHp">; statValue: number } {
  const lower = choice.toLowerCase();
  const score = {
    strength:   STRENGTH_KEYWORDS.filter(k => lower.includes(k)).length,
    cunning:    CUNNING_KEYWORDS.filter(k => lower.includes(k)).length,
    will:       WILL_KEYWORDS.filter(k => lower.includes(k)).length,
    reputation: REPUTATION_KEYWORDS.filter(k => lower.includes(k)).length,
  };
  const best = (["strength","cunning","will","reputation"] as const).reduce((a, b) => {
    if (score[a] !== score[b]) return score[a] > score[b] ? a : b;
    return stats[a] >= stats[b] ? a : b;
  });
  return { stat: best, statValue: stats[best] };
}

function computeRoll(choice: string, stats: Stats, skillBonus = 0): RollResult {
  const { stat, statValue } = detectStat(choice, stats);
  const raw = rollD20();
  const modifier = statModifier(statValue) + skillBonus;
  const total = Math.max(1, Math.min(20, raw + modifier));
  return { raw, stat, statValue, modifier, total, outcome: outcomeFromTotal(total) };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_EN = `You are a storyteller for a dark fantasy RPG with a dice-based stat system.

NARRATION RULES:
- Write in second person ("You...")
- Narration: exactly 3 to 5 sentences, direct and vivid, no filler
- Always provide exactly 3 choices, each one sentence, specific and actionable
- Choices must feel meaningfully different (aggressive / cautious / clever)
- After 8-12 turns, end with isEnding: true and no choices
- NEVER mention being an AI

DICE & OUTCOME:
You will receive a DICE ROLL section telling you the result of the player's action.
You MUST reflect this outcome in the narration:
- CRITICAL FAILURE: Everything goes catastrophically wrong. Maximum consequence, unexpected disaster.
- FAILURE: The attempt fails clearly. A new problem or danger emerges.
- PARTIAL SUCCESS: Achieve part of the goal, but with a significant cost, complication, or twist.
- SUCCESS: Clear success. The action works as intended, story advances positively.
- CRITICAL SUCCESS: Exceptional result. Something extra or surprising happens in the player's favor.

STAT SYSTEM:
Adjust statChanges to reflect consequences. Ranges: hp 0-maxHp, others 1-10.
- hp: -25 to +15 based on danger/recovery
- strength/cunning/will: ±1 for meaningful growth moments
- reputation: ±1 to ±2 for social/visible events
- If player hp reaches 0: set isEnding: true, write a death scene

ENEMY SYSTEM:
When the story enters combat with any creature, include enemy tracking in your response.
Set "inCombat": true and include the "enemy" object whenever a fight is happening.
Track enemy HP across turns based on the dice outcome:
- CRITICAL SUCCESS: enemy hp -20 to -30
- SUCCESS: enemy hp -10 to -18
- PARTIAL: enemy hp -4 to -10 AND player takes damage (statChanges.hp -5 to -12)
- FAILURE: enemy hp unchanged AND player takes damage (statChanges.hp -8 to -16)
- CRITICAL FAILURE: enemy hp unchanged AND player takes heavy damage (statChanges.hp -15 to -25)

Enemy stats scale with the narrative threat level. Typical: hp 20-80, attack 3-10, defense 1-6.
When enemy hp reaches 0: set "inCombat": false, "enemy": null, narrate the victory.
When combat is NOT happening: set "inCombat": false, omit "enemy".

Include "enemyChanges": { "hp": <negative number or 0> } whenever in combat, to show damage dealt.

ALWAYS respond with valid JSON only, no markdown:
{
  "narration": "...",
  "choices": ["...", "...", "..."],
  "statChanges": { "hp": 0, "strength": 0, "cunning": 0, "will": 0, "reputation": 0 },
  "isEnding": false,
  "inCombat": false,
  "enemy": null,
  "enemyChanges": { "hp": 0 }
}`;

const SYSTEM_PROMPT_KO = `당신은 주사위 기반 스탯 시스템이 있는 다크 판타지 RPG의 스토리텔러입니다.

서사 규칙:
- 2인칭("당신은..." 또는 "당신이...")으로 작성
- 서사: 정확히 3~5문장, 직접적이고 생동감 있게, 군더더기 없이
- 항상 정확히 3개의 선택지, 각각 한 문장, 구체적인 행동
- 선택지는 명확히 다른 방향 (공격적 / 신중한 / 영리한)
- 8~12턴 후 isEnding: true로 마무리
- AI임을 절대 언급 금지
- 모든 내용을 한국어로 작성

주사위 & 결과:
DICE ROLL 항목에서 플레이어 행동의 결과를 확인합니다.
이 결과를 서사에 반드시 반영해야 합니다:
- 대실패: 모든 것이 최악으로 흘러갑니다.
- 실패: 시도가 명확히 실패하고, 새 문제가 발생합니다.
- 부분 성공: 일부 달성, 하지만 대가나 복잡한 상황이 따릅니다.
- 성공: 명확한 성공.
- 대성공: 탁월한 결과, 플레이어에게 유리한 예상 밖의 일이 일어납니다.

스탯 시스템:
결과에 따라 statChanges를 조정합니다. 범위: hp 0~maxHp, 나머지 1~10.
- hp: -25 ~ +15
- strength/cunning/will: ±1
- reputation: ±1 ~ ±2
- 플레이어 hp가 0이 되면: isEnding: true, 사망 장면 작성

적 시스템:
전투가 시작되면 "inCombat": true로 설정하고 "enemy" 객체를 포함합니다.
주사위 결과에 따라 적 HP를 추적합니다:
- 대성공: 적 hp -20 ~ -30
- 성공: 적 hp -10 ~ -18
- 부분 성공: 적 hp -4 ~ -10 AND 플레이어도 피해 (statChanges.hp -5 ~ -12)
- 실패: 적 hp 변화 없음 AND 플레이어 피해 (statChanges.hp -8 ~ -16)
- 대실패: 적 hp 변화 없음 AND 플레이어 큰 피해 (statChanges.hp -15 ~ -25)

적 스탯: hp 20~80, attack 3~10, defense 1~6
적 hp가 0이 되면: "inCombat": false, "enemy": null, 승리 서술
전투 중이 아닐 때: "inCombat": false, "enemy" 생략

전투 중일 때 "enemyChanges": { "hp": <음수 또는 0> }를 포함합니다.

마크다운 없이 유효한 JSON만 응답:
{
  "narration": "...",
  "choices": ["...", "...", "..."],
  "statChanges": { "hp": 0, "strength": 0, "cunning": 0, "will": 0, "reputation": 0 },
  "isEnding": false,
  "inCombat": false,
  "enemy": null,
  "enemyChanges": { "hp": 0 }
}`;

const OUTCOME_CONTEXT_EN: Record<DiceOutcome, string> = {
  critical_failure: "CRITICAL FAILURE — everything goes catastrophically wrong",
  failure:          "FAILURE — the attempt clearly fails, a new problem emerges",
  partial:          "PARTIAL SUCCESS — partial achievement with a cost or complication",
  success:          "SUCCESS — the action works as intended",
  critical_success: "CRITICAL SUCCESS — exceptional outcome, something extra happens",
};

const OUTCOME_CONTEXT_KO: Record<DiceOutcome, string> = {
  critical_failure: "대실패 — 모든 것이 최악으로 흘러갑니다",
  failure:          "실패 — 시도가 명확히 실패하고, 새 문제가 발생합니다",
  partial:          "부분 성공 — 일부 달성, 하지만 대가나 복잡한 상황이 따릅니다",
  success:          "성공 — 행동이 의도대로 효과를 발휘합니다",
  critical_success: "대성공 — 탁월한 결과, 예상 밖의 행운이 따릅니다",
};

// ─── Class starting stats & backgrounds ──────────────────────────────────────

const CLASS_STATS: Record<string, Stats> = {
  Warrior:     { hp: 100, maxHp: 100, strength: 8, cunning: 3, will: 4, reputation: 5 },
  Rogue:       { hp:  70, maxHp:  70, strength: 4, cunning: 9, will: 3, reputation: 3 },
  Mage:        { hp:  60, maxHp:  60, strength: 2, cunning: 6, will: 9, reputation: 5 },
  Paladin:     { hp:  90, maxHp:  90, strength: 7, cunning: 3, will: 8, reputation: 7 },
  Ranger:      { hp:  80, maxHp:  80, strength: 6, cunning: 7, will: 5, reputation: 4 },
  Necromancer: { hp:  65, maxHp:  65, strength: 3, cunning: 6, will: 8, reputation: 2 },
  Bard:        { hp:  70, maxHp:  70, strength: 3, cunning: 8, will: 6, reputation: 7 },
  Druid:       { hp:  75, maxHp:  75, strength: 5, cunning: 5, will: 8, reputation: 4 },
  전사:         { hp: 100, maxHp: 100, strength: 8, cunning: 3, will: 4, reputation: 5 },
  도적:         { hp:  70, maxHp:  70, strength: 4, cunning: 9, will: 3, reputation: 3 },
  마법사:       { hp:  60, maxHp:  60, strength: 2, cunning: 6, will: 9, reputation: 5 },
  성기사:       { hp:  90, maxHp:  90, strength: 7, cunning: 3, will: 8, reputation: 7 },
  레인저:       { hp:  80, maxHp:  80, strength: 6, cunning: 7, will: 5, reputation: 4 },
  사령술사:     { hp:  65, maxHp:  65, strength: 3, cunning: 6, will: 8, reputation: 2 },
  음유시인:     { hp:  70, maxHp:  70, strength: 3, cunning: 8, will: 6, reputation: 7 },
  드루이드:     { hp:  75, maxHp:  75, strength: 5, cunning: 5, will: 8, reputation: 4 },
};

const DEFAULT_STATS: Stats = { hp: 75, maxHp: 75, strength: 5, cunning: 5, will: 5, reputation: 5 };

const CLASS_BACKGROUNDS: Record<string, { location: string; background: string }> = {
  Warrior:     { location: "the blood-soaked front lines of a crumbling fortress", background: "You are a seasoned warrior, scarred from a hundred battles. Your regiment was slaughtered last night — you alone survived. The fortress gates are failing." },
  Rogue:       { location: "the rain-slicked rooftops of a corrupt city", background: "You are a rogue who just stole something you shouldn't have. The thieves' guild wants it back. The city guard wants you dead. You have one hour before dawn." },
  Mage:        { location: "the ruins of a forbidden arcane tower", background: "You are a mage who broke into a sealed tower seeking lost knowledge. The spell you cast to open it awakened something. Now the tower door won't open from the inside." },
  Paladin:     { location: "a desecrated cathedral at the edge of the cursed lands", background: "You are a paladin sent alone to investigate why prayers from this region have gone silent. Inside the cathedral, the holy symbols have been reversed. Something breathes in the dark." },
  Ranger:      { location: "a dying forest at the border of the known world", background: "You are a ranger who has tracked a creature for three days through a forest that is rotting from the inside. The tracks stop here — at a clearing where the trees have been arranged into a symbol." },
  Necromancer: { location: "a collapsed crypt beneath an ancient city", background: "You are a necromancer whose ritual went wrong. You were trying to bind a single spirit. Instead, something far older answered. The crypt has sealed itself. The dead are stirring." },
  Bard:        { location: "a crossroads tavern at the edge of a war zone", background: "You are a bard who overheard a secret conversation between two generals — a plan that would end thousands of lives. Both men saw your face. You need to decide what to do with what you know." },
  Druid:       { location: "an ancient stone circle deep in a poisoned wilderness", background: "You are a druid who felt the land scream three nights ago. You followed the wound to its source: this circle, where the stones pulse with unnatural light. The animals flee. Only you stay." },
  전사:    { location: "무너져가는 요새의 피로 물든 최전선", background: "당신은 백 번의 전투에서 살아남은 노련한 전사입니다. 어젯밤 당신의 부대가 전멸했습니다 — 살아남은 건 오직 당신뿐입니다. 요새의 문이 무너지고 있습니다." },
  도적:    { location: "부패한 도시의 빗속 지붕 위", background: "당신은 훔쳐서는 안 될 것을 훔친 도적입니다. 도적 길드는 그것을 되찾으려 하고, 시위대는 당신을 죽이려 합니다. 새벽까지 한 시간이 남았습니다." },
  마법사:  { location: "금지된 마탑의 폐허", background: "당신은 잃어버린 지식을 찾아 봉인된 탑에 잠입한 마법사입니다. 문을 열기 위해 시전한 주문이 무언가를 깨웠습니다. 이제 탑의 문이 안에서 열리지 않습니다." },
  성기사:  { location: "저주받은 땅 끝에 있는 훼손된 대성당", background: "당신은 이 지역의 기도가 왜 침묵했는지 단독으로 조사하러 파견된 성기사입니다. 성당 안에는 성스러운 상징들이 뒤집혀 있습니다. 어둠 속에서 무언가가 숨 쉬고 있습니다." },
  레인저:  { location: "알려진 세계의 경계, 죽어가는 숲", background: "당신은 사흘째 내부에서 썩어가는 숲을 통해 어떤 존재를 추적해온 레인저입니다. 발자국이 여기서 끊겼습니다 — 나무들이 어떤 문양으로 배열된 공터에서." },
  사령술사: { location: "고대 도시 아래에 무너진 납골당", background: "당신은 의식이 잘못된 사령술사입니다. 하나의 영혼을 결박하려 했지만, 훨씬 오래된 무언가가 응답했습니다. 납골당이 스스로 봉인되었습니다. 죽은 자들이 깨어나고 있습니다." },
  음유시인: { location: "전쟁 지대 끝에 있는 사거리 여관", background: "당신은 두 장군 사이의 비밀 대화를 엿들은 음유시인입니다 — 수천 명의 목숨을 앗아갈 계획. 두 남자 모두 당신의 얼굴을 봤습니다." },
  드루이드: { location: "독이 든 광야 깊숙이 있는 고대 석조 원형 진지", background: "당신은 사흘 전 밤 대지의 비명 소리를 들은 드루이드입니다. 상처의 원점을 따라왔습니다: 돌들이 초자연적인 빛으로 맥동하는 이 원형 진지. 동물들은 도망칩니다. 오직 당신만이 남아 있습니다." },
};

function applyStatChanges(stats: Stats, changes: StatChanges): Stats {
  const r = { ...stats };
  if (changes.hp !== undefined)         r.hp         = Math.max(0, Math.min(r.maxHp, r.hp + changes.hp));
  if (changes.strength !== undefined)   r.strength   = Math.max(1, Math.min(10, r.strength + changes.strength));
  if (changes.cunning !== undefined)    r.cunning    = Math.max(1, Math.min(10, r.cunning + changes.cunning));
  if (changes.will !== undefined)       r.will       = Math.max(1, Math.min(10, r.will + changes.will));
  if (changes.reputation !== undefined) r.reputation = Math.max(1, Math.min(10, r.reputation + changes.reputation));
  return r;
}

function tickSkillCooldowns(skills: Skill[]): Skill[] {
  return skills.map(s => ({ ...s, currentCooldown: Math.max(0, s.currentCooldown - 1) }));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post("/start", async (req, res) => {
  try {
    const { genre = "fantasy", characterClass, playerName, lang = "en" } = req.body;
    const title = playerName ? `${playerName}'s Chronicle` : "Chronicle";

    const [session] = await db.insert(gameSessions).values({ title, genre }).returning();

    const classStr: string = characterClass || "";
    const startingStats: Stats = CLASS_STATS[classStr] || DEFAULT_STATS;
    const skills = getClassSkills(classStr);

    statsMap.set(session.id, { ...startingStats });
    enemyMap.set(session.id, null);
    playerMetas.set(session.id, { name: playerName || "", characterClass: classStr, skills });

    const bg = CLASS_BACKGROUNDS[classStr];
    const systemPrompt = lang === "ko" ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;

    const skillsInfo = skills.map(s => `${lang === "ko" ? s.nameKo : s.name}: ${lang === "ko" ? s.descriptionKo : s.description}`).join("; ");

    const userMessage = bg
      ? `SETTING: ${bg.location}\n\nBACKGROUND: ${bg.background}\n\nGenre: ${genre}\nCharacter Class: ${classStr}\nSTATS: HP ${startingStats.hp}/${startingStats.maxHp}, STR ${startingStats.strength}, CUN ${startingStats.cunning}, WIL ${startingStats.will}, REP ${startingStats.reputation}\nSKILLS: ${skillsInfo}\n\nBegin the story. Write the opening narration and present the first 3 choices.`
      : `Genre: ${genre}\nCharacter Class: ${classStr || "Adventurer"}\nSTATS: HP ${startingStats.hp}/${startingStats.maxHp}, STR ${startingStats.strength}, CUN ${startingStats.cunning}, WIL ${startingStats.will}, REP ${startingStats.reputation}\nSKILLS: ${skillsInfo}\n\nBegin the story.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      response_format: { type: "json_object" },
      temperature: 0.85,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const data = JSON.parse(raw);

    await db.insert(storyEntries).values({ sessionId: session.id, entryType: "narration", content: JSON.stringify(data) });

    res.json({ sessionId: session.id, stats: startingStats, skills, ...data });
  } catch (err) {
    req.log.error(err, "Error starting game");
    res.status(500).json({ error: "Failed to start game" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [session] = await db.select().from(gameSessions).where(eq(gameSessions.id, id));
    if (!session) return res.status(404).json({ error: "Session not found" });

    const entries = await db.select().from(storyEntries).where(eq(storyEntries.sessionId, id));
    const stats = statsMap.get(id) || DEFAULT_STATS;
    const playerMeta = playerMetas.get(id);
    const enemy = enemyMap.get(id) ?? null;

    res.json({ session, entries, stats, playerMeta, enemy });
  } catch (err) {
    req.log.error(err, "Error fetching game");
    res.status(500).json({ error: "Failed to fetch game" });
  }
});

router.post("/:id/choice", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { choiceIndex, choiceText, lang = "en", skillId } = req.body;

    const [session] = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });

    const currentStats = statsMap.get(sessionId) || DEFAULT_STATS;
    const meta = playerMetas.get(sessionId);
    let skills = meta?.skills ?? [];

    // Find used skill and compute bonus
    let skillBonus = 0;
    let usedSkill: Skill | undefined;
    let skillHpEffect = 0;

    if (skillId) {
      usedSkill = skills.find(s => s.id === skillId && s.currentCooldown === 0);
      if (usedSkill) {
        skillBonus   = usedSkill.bonusValue;
        skillHpEffect = usedSkill.hpEffect ?? 0;
      }
    }

    // Apply skill HP effect before roll (e.g. healing)
    let statsBeforeRoll = currentStats;
    if (skillHpEffect !== 0) {
      statsBeforeRoll = applyStatChanges(currentStats, { hp: skillHpEffect });
    }

    const roll = computeRoll(choiceText as string, statsBeforeRoll, skillBonus);
    const outcomeCtx = lang === "ko" ? OUTCOME_CONTEXT_KO[roll.outcome] : OUTCOME_CONTEXT_EN[roll.outcome];
    const currentEnemy = enemyMap.get(sessionId) ?? null;

    // Build message history
    const entries = await db.select().from(storyEntries).where(eq(storyEntries.sessionId, sessionId));
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = lang === "ko" ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;
    messages.push({ role: "system", content: systemPrompt });

    for (const entry of entries) {
      const d = JSON.parse(entry.content);
      if (entry.entryType === "narration") {
        messages.push({ role: "assistant", content: JSON.stringify(d) });
      } else if (entry.entryType === "choice") {
        const cd = JSON.parse(entry.content);
        messages.push({ role: "user", content: cd.context ?? cd.text });
      }
    }

    const skillNote = usedSkill
      ? `\nSKILL USED: "${lang === "ko" ? usedSkill.nameKo : usedSkill.name}" — ${lang === "ko" ? usedSkill.descriptionKo : usedSkill.description} (roll modifier +${skillBonus})`
      : "";

    const enemyNote = currentEnemy
      ? `\nCURRENT ENEMY: ${currentEnemy.name} (HP ${currentEnemy.hp}/${currentEnemy.maxHp}, ATK ${currentEnemy.attack}, DEF ${currentEnemy.defense})`
      : "";

    const userMsg = `Player chose option ${choiceIndex + 1}: "${choiceText}"${skillNote}\n\nDICE ROLL: ${outcomeCtx}\nRolled: d20=${roll.raw}, ${roll.stat.toUpperCase()} modifier=${roll.modifier > 0 ? "+" : ""}${roll.modifier}, Total=${roll.total}${enemyNote}\nPlayer stats: HP ${statsBeforeRoll.hp}/${statsBeforeRoll.maxHp}, STR ${statsBeforeRoll.strength}, CUN ${statsBeforeRoll.cunning}, WIL ${statsBeforeRoll.will}, REP ${statsBeforeRoll.reputation}\nTurn: ${session.turnCount + 1}`;

    messages.push({ role: "user", content: userMsg });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.85,
    });

    const rawResp = completion.choices[0].message.content ?? "{}";
    const data = JSON.parse(rawResp);
    const statChanges: StatChanges = data.statChanges || {};

    // Apply stat changes on top of any skill HP effect already applied
    let newStats = applyStatChanges(statsBeforeRoll, statChanges);
    if (newStats.hp <= 0) data.isEnding = true;
    statsMap.set(sessionId, newStats);

    // Update enemy state
    const newEnemy: Enemy | null = data.inCombat && data.enemy
      ? { name: data.enemy.name, hp: Math.max(0, data.enemy.hp), maxHp: data.enemy.maxHp, attack: data.enemy.attack, defense: data.enemy.defense }
      : null;
    enemyMap.set(sessionId, newEnemy);

    // Apply skill cooldown
    if (usedSkill) {
      skills = skills.map(s => s.id === usedSkill!.id ? { ...s, currentCooldown: s.cooldown } : s);
    }
    skills = tickSkillCooldowns(skills);
    if (meta) playerMetas.set(sessionId, { ...meta, skills });

    // Persist entries
    const choiceContext = `${userMsg}`;
    await db.insert(storyEntries).values([
      { sessionId, entryType: "choice", content: JSON.stringify({ index: choiceIndex, text: choiceText, context: choiceContext }) },
      { sessionId, entryType: "narration", content: JSON.stringify(data), choiceIndex },
    ]);

    await db.update(gameSessions)
      .set({ turnCount: session.turnCount + 1, updatedAt: new Date() })
      .where(eq(gameSessions.id, sessionId));

    // Compute enemyChanges for display
    const prevEnemyHp = currentEnemy?.hp;
    const newEnemyHp  = newEnemy?.hp;
    const enemyHpDelta = (prevEnemyHp !== undefined && newEnemyHp !== undefined)
      ? newEnemyHp - prevEnemyHp
      : (data.enemyChanges?.hp ?? 0);

    const totalStatChanges: StatChanges = { ...statChanges };
    if (skillHpEffect !== 0) totalStatChanges.hp = (totalStatChanges.hp ?? 0) + skillHpEffect;

    res.json({
      ...data,
      roll,
      statChanges: totalStatChanges,
      stats: newStats,
      skills,
      enemy: newEnemy,
      enemyChanges: { hp: enemyHpDelta },
      inCombat: !!data.inCombat,
    });
  } catch (err) {
    req.log.error(err, "Error processing choice");
    res.status(500).json({ error: "Failed to process choice" });
  }
});

export default router;
