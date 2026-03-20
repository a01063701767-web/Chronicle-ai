export type Stats = {
  hp: number;
  maxHp: number;
  strength: number;
  cunning: number;
  will: number;
  reputation: number;
};

export type StatChanges = {
  hp?: number;
  strength?: number;
  cunning?: number;
  will?: number;
  reputation?: number;
};

export type DiceOutcome =
  | "critical_failure"
  | "failure"
  | "partial"
  | "success"
  | "critical_success";

export type RollResult = {
  raw: number;
  stat: keyof Omit<Stats, "hp" | "maxHp">;
  statValue: number;
  modifier: number;
  total: number;
  outcome: DiceOutcome;
};

export type Skill = {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  descriptionKo: string;
  statBonus: keyof Omit<Stats, "hp" | "maxHp">;
  bonusValue: number;
  hpEffect?: number;
  cooldown: number;
  currentCooldown: number;
};

export type Enemy = {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
};

export type EnemyChanges = {
  hp?: number;
};

export type StoryResponse = {
  narration: string;
  choices: string[];
  statChanges?: StatChanges;
  isEnding?: boolean;
  roll?: RollResult;
  stats?: Stats;
  skills?: Skill[];
  enemy?: Enemy | null;
  enemyChanges?: EnemyChanges;
  inCombat?: boolean;
};
