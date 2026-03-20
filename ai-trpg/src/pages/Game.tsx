import {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Loader2, ArrowLeft, BookOpen, Trophy, Skull, Dices, User, Zap,
} from "lucide-react";
import type { StoryResponse, Stats, StatChanges, RollResult, DiceOutcome, Skill, Enemy, EnemyChanges } from "@/types";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";
import { StatsPanel } from "@/components/StatsPanel";
import { EnemyPanel } from "@/components/EnemyPanel";
import { SkillsBar } from "@/components/SkillsBar";

// ─── Types ────────────────────────────────────────────────────────────────────

type StoryBeat = {
  id: number;
  narration: string;
  sentences: string[];
  choices: string[];
  chosenIndex?: number;
  chosenText?: string;
  roll?: RollResult;
  statChanges?: StatChanges;
  isEnding?: boolean;
};

type DicePhase = "idle" | "ready" | "rolling";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?。\n]+[.!?。]*\n?/g);
  if (!parts) return [text];
  const clean = parts.map(s => s.trim()).filter(Boolean);
  return clean.length ? clean : [text];
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

const TYPING_SPEED_MS = 26;

const Typewriter = memo(function Typewriter({
  text, skip, onComplete,
}: { text: string; skip: boolean; onComplete: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const idxRef      = useRef(0);
  const doneRef     = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cbRef       = useRef(onComplete);
  cbRef.current     = onComplete;

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setDisplayed("");
    idxRef.current  = 0;
    doneRef.current = false;

    intervalRef.current = setInterval(() => {
      if (doneRef.current) { clearInterval(intervalRef.current!); return; }
      idxRef.current++;
      setDisplayed(text.slice(0, idxRef.current));
      if (idxRef.current >= text.length) {
        clearInterval(intervalRef.current!);
        doneRef.current = true;
        cbRef.current();
      }
    }, TYPING_SPEED_MS);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [text]);

  useEffect(() => {
    if (skip && !doneRef.current) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      doneRef.current = true;
      setDisplayed(text);
      cbRef.current();
    }
  }, [skip, text]);

  const done = displayed.length >= text.length;
  return (
    <span>
      {displayed}
      {!done && <span className="inline-block w-0.5 h-4 bg-primary/70 ml-0.5 animate-pulse align-middle" />}
    </span>
  );
});

// ─── Dice ─────────────────────────────────────────────────────────────────────

const OUTCOME_STYLE: Record<DiceOutcome, { color: string; bg: string; border: string }> = {
  critical_failure: { color: "text-red-400",   bg: "bg-red-950/40",    border: "border-red-500/40"    },
  failure:          { color: "text-orange-400", bg: "bg-orange-950/30", border: "border-orange-500/30" },
  partial:          { color: "text-amber-400",  bg: "bg-amber-950/30",  border: "border-amber-500/30"  },
  success:          { color: "text-green-400",  bg: "bg-green-950/30",  border: "border-green-500/30"  },
  critical_success: { color: "text-yellow-300", bg: "bg-yellow-950/30", border: "border-yellow-400/50" },
};

const DiceRollCard = memo(function DiceRollCard({ roll }: { roll: RollResult }) {
  const { t } = useLang();
  const d            = t.dice;
  const style        = OUTCOME_STYLE[roll.outcome];
  const statLabel    = (d.statNames as Record<string, string>)[roll.stat] ?? roll.stat.toUpperCase();
  const outcomeLabel = (d.outcomes  as Record<string, string>)[roll.outcome] ?? roll.outcome;
  const modSign      = roll.modifier >= 0 ? `+${roll.modifier}` : `${roll.modifier}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${style.bg} ${style.border}`}
    >
      <motion.div initial={{ rotate: -180, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }}
        transition={{ duration: 0.5, type: "spring", stiffness: 250 }}>
        <Dices className={`w-5 h-5 shrink-0 ${style.color}`} />
      </motion.div>
      <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground/70">
        <span className="text-foreground/50 text-xs">d20</span>
        <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
          className="text-foreground font-bold text-lg">{roll.raw}</motion.span>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <span className="text-xs">{statLabel}</span>
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className={`text-xs font-bold ${roll.modifier >= 0 ? "text-green-400/90" : "text-red-400/90"}`}>{modSign}</motion.span>
        <span className="text-muted-foreground/40 text-xs">=</span>
        <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.28, type: "spring", stiffness: 300 }}
          className={`font-black text-xl ${style.color}`}>{roll.total}</motion.span>
      </div>
      <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }}
        className={`ml-auto text-xs font-bold tracking-wide ${style.color}`}>{outcomeLabel}</motion.span>
    </motion.div>
  );
});

const DiceAnimation = memo(function DiceAnimation() {
  const [face, setFace] = useState(1);
  useEffect(() => {
    let speed = 60;
    let count = 0;
    const max = 28;
    const run = () => {
      setFace(Math.floor(Math.random() * 20) + 1);
      count++;
      speed = Math.min(speed + count * 3, 250);
      if (count < max) setTimeout(run, speed);
    };
    run();
  }, []);

  return (
    <motion.div
      animate={{ rotate: [0, -15, 15, -10, 10, 0], scale: [1, 1.15, 1.05, 1.1, 1] }}
      transition={{ duration: 0.6, ease: "easeInOut", repeat: Infinity }}
      className="flex items-center justify-center w-16 h-16 rounded-xl border-2 border-primary/60 bg-primary/10 text-primary font-black text-2xl select-none"
    >
      {face}
    </motion.div>
  );
});

// ─── Past beat ────────────────────────────────────────────────────────────────

const PastBeat = memo(function PastBeat({
  beat, beatIdx, choseLabel,
}: { beat: StoryBeat; beatIdx: number; choseLabel: string }) {
  return (
    <div className="space-y-4 opacity-65">
      {beat.roll && beatIdx > 0 && <DiceRollCard roll={beat.roll} />}
      <div className="space-y-2.5">
        {beat.sentences.map((s, i) => (
          <p key={i} className="text-foreground/70 leading-relaxed font-serif text-sm">{s}</p>
        ))}
      </div>
      {beat.chosenText && (
        <div className="pl-4 border-l-2 border-primary/20">
          <p className="text-muted-foreground/60 text-xs italic">
            {choseLabel} <span className="text-foreground/50">{beat.chosenText}</span>
          </p>
        </div>
      )}
    </div>
  );
});

// ─── Game ─────────────────────────────────────────────────────────────────────

export default function Game() {
  const { id }      = useParams<{ id: string }>();
  const sessionId   = parseInt(id);
  const [, setLocation] = useLocation();
  const { lang, t } = useLang();
  const bottomRef   = useRef<HTMLDivElement>(null);
  const beatIdRef   = useRef(0);
  const clearTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [beats,          setBeats]         = useState<StoryBeat[]>([]);
  const [isEnded,        setIsEnded]        = useState(false);
  const [revealedCount,  setRevealedCount]  = useState(1);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [stats,          setStats]          = useState<Stats | null>(null);
  const [latestChanges,  setLatestChanges]  = useState<StatChanges>({});
  const [isTyping,       setIsTyping]       = useState(false);
  const [skipTyping,     setSkipTyping]     = useState(false);
  const [playerMeta,     setPlayerMeta]     = useState<{ name: string; characterClass: string } | null>(null);

  // Skills & enemy
  const [skills,          setSkills]         = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [enemy,           setEnemy]          = useState<Enemy | null>(null);
  const [enemyChanges,    setEnemyChanges]   = useState<EnemyChanges>({});
  const [inCombat,        setInCombat]       = useState(false);

  // Dice phase
  const [pendingChoice, setPendingChoice] = useState<{ index: number; text: string } | null>(null);
  const [dicePhase,     setDicePhase]     = useState<DicePhase>("idle");

  const currentBeat      = beats[beats.length - 1];
  const currentSentences = useMemo(() => currentBeat?.sentences ?? [], [currentBeat]);
  const allRevealed      = revealedCount >= currentSentences.length;
  const isDead           = stats !== null && stats.hp <= 0;

  const { data: gameData, isLoading } = useQuery({
    queryKey: [`/api/game/${sessionId}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/game/${sessionId}`);
      return res.json();
    },
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (!gameData || beats.length > 0) return;
    if (gameData.stats)      setStats(gameData.stats);
    if (gameData.playerMeta) {
      setPlayerMeta(gameData.playerMeta);
      setSkills(gameData.playerMeta.skills ?? []);
    }
    if (gameData.enemy)      setEnemy(gameData.enemy);
    if (gameData.entries?.length > 0) {
      const last = [...gameData.entries].reverse().find((e: any) => e.entryType === "narration");
      if (last) {
        const data = JSON.parse(last.content);
        setBeats([{
          id: beatIdRef.current++,
          narration: data.narration,
          sentences: splitSentences(data.narration),
          choices: data.choices || [],
          isEnding: data.isEnding,
        }]);
        setRevealedCount(1);
        setIsTyping(true);
        if (data.isEnding) setIsEnded(true);
        if (data.inCombat && data.enemy) { setEnemy(data.enemy); setInCombat(true); }
      }
    }
  }, [gameData]);

  const scheduleChangeClear = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { setLatestChanges({}); setEnemyChanges({}); }, 3000);
  }, []);

  const choiceMutation = useMutation({
    mutationFn: async ({ choiceIndex, choiceText, skillId }: { choiceIndex: number; choiceText: string; skillId?: string }) => {
      const res = await apiRequest("POST", `/api/game/${sessionId}/choice`, { choiceIndex, choiceText, lang, skillId });
      return res.json() as Promise<StoryResponse>;
    },
    onSuccess: (data, variables) => {
      if (data.stats) {
        setLatestChanges(data.statChanges ?? {});
        setStats(data.stats);
      }
      if (data.skills) setSkills(data.skills);

      // Update enemy
      if (data.inCombat && data.enemy) {
        setEnemy(data.enemy);
        setInCombat(true);
        setEnemyChanges(data.enemyChanges ?? {});
      } else {
        setEnemy(null);
        setInCombat(false);
        setEnemyChanges({});
      }

      scheduleChangeClear();

      setBeats(prev => {
        const updated = prev.map((b, i) =>
          i === prev.length - 1
            ? { ...b, chosenIndex: variables.choiceIndex, chosenText: variables.choiceText }
            : b
        );
        return [...updated, {
          id: beatIdRef.current++,
          narration: data.narration,
          sentences: splitSentences(data.narration),
          choices: data.choices || [],
          roll: data.roll,
          statChanges: data.statChanges,
          isEnding: data.isEnding,
        }];
      });
      setRevealedCount(1);
      setChoicesVisible(false);
      setPendingChoice(null);
      setDicePhase("idle");
      setSelectedSkillId(null);
      setIsTyping(true);
      setSkipTyping(false);
      if (data.isEnding) setIsEnded(true);
    },
    onError: () => {
      setPendingChoice(null);
      setDicePhase("idle");
    },
  });

  const selectChoice = useCallback((index: number, text: string) => {
    if (choiceMutation.isPending) return;
    setPendingChoice({ index, text });
    setDicePhase("ready");
  }, [choiceMutation.isPending]);

  const rollDice = useCallback(() => {
    if (!pendingChoice || dicePhase !== "ready") return;
    setDicePhase("rolling");
    choiceMutation.mutate({
      choiceIndex: pendingChoice.index,
      choiceText: pendingChoice.text,
      skillId: selectedSkillId ?? undefined,
    });
  }, [pendingChoice, dicePhase, choiceMutation, selectedSkillId]);

  const cancelChoice = useCallback(() => {
    setPendingChoice(null);
    setDicePhase("idle");
  }, []);

  const handleTypingComplete = useCallback(() => {
    setIsTyping(false);
    setSkipTyping(false);
  }, []);

  const advanceSentence = useCallback(() => {
    if (choiceMutation.isPending || dicePhase !== "idle") return;
    if (isTyping)     { setSkipTyping(true); return; }
    if (!allRevealed) {
      setRevealedCount(c => Math.min(c + 1, currentSentences.length));
      setIsTyping(true);
      setSkipTyping(false);
      return;
    }
    if (!choicesVisible && !currentBeat?.isEnding && !currentBeat?.chosenText) {
      setChoicesVisible(true);
    }
  }, [isTyping, allRevealed, choicesVisible, currentBeat, currentSentences.length, choiceMutation.isPending, dicePhase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [revealedCount, choicesVisible, beats.length, choiceMutation.isPending, isTyping, dicePhase]);

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
          <p className="text-muted-foreground animate-pulse">{t.loadingStory}</p>
        </div>
      </div>
    );
  }

  const pastBeats  = beats.slice(0, -1);
  const activeBeat = beats[beats.length - 1];
  const turnCount  = beats.length;

  // Skill lookup for dice panel display
  const activeSkill = selectedSkillId ? skills.find(s => s.id === selectedSkillId) : null;

  return (
    <div className="min-h-screen flex flex-col select-none bg-background" onClick={advanceSentence}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t.newChronicle}</span>
          </button>

          <div className="flex flex-col items-center min-w-0">
            {playerMeta && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="font-medium text-foreground/80 truncate max-w-[120px]">
                  {playerMeta.name || "—"}
                </span>
                <span className="text-muted-foreground/50">·</span>
                <span>{playerMeta.characterClass}</span>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground/50">
              {isEnded ? t.chronicleComplete : `${t.turnLabel} ${turnCount}`}
            </div>
          </div>

          <LangToggle />
        </div>
      </header>

      {/* ── Player stats panel (sticky) ────────────────────────────── */}
      {stats && <StatsPanel stats={stats} latestChanges={latestChanges} />}

      {/* ── Enemy panel (sticky, below stats) ─────────────────────── */}
      <div className="sticky top-[calc(56px+6rem)] z-[8]" onClick={e => e.stopPropagation()}>
        <AnimatePresence>
          {inCombat && enemy && (
            <EnemyPanel key="enemy" enemy={enemy} changes={enemyChanges} />
          )}
        </AnimatePresence>
      </div>

      {/* ── Scrollable story ───────────────────────────────────────── */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 space-y-8">

        {/* Past beats */}
        {pastBeats.map((beat, idx) => (
          <PastBeat key={beat.id} beat={beat} beatIdx={idx} choseLabel={t.choseLabel} />
        ))}

        {/* Separator */}
        {pastBeats.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border/30" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
            <div className="flex-1 h-px bg-border/30" />
          </div>
        )}

        {/* Active beat */}
        {activeBeat && (
          <div className="space-y-4">
            {activeBeat.roll && pastBeats.length > 0 && <DiceRollCard roll={activeBeat.roll} />}

            <div className="space-y-3">
              {currentSentences.slice(0, revealedCount).map((sentence, i) => (
                <p key={i} className="text-foreground/95 leading-relaxed font-serif">
                  {i === revealedCount - 1 && isTyping ? (
                    <Typewriter text={sentence} skip={skipTyping} onComplete={handleTypingComplete} />
                  ) : sentence}
                </p>
              ))}
            </div>

            {/* Tap hints */}
            {!choiceMutation.isPending && dicePhase === "idle" && (
              <AnimatePresence>
                {isTyping && (
                  <motion.p key="typing-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-xs text-muted-foreground/40 italic">{t.tapToContinue}</motion.p>
                )}
                {!isTyping && allRevealed && !choicesVisible && !activeBeat.isEnding && !activeBeat.chosenText && (
                  <motion.p key="choice-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-xs text-muted-foreground/40 italic">{t.tapForChoices}</motion.p>
                )}
              </AnimatePresence>
            )}

            {/* ── Choice list ── */}
            <AnimatePresence>
              {choicesVisible && !activeBeat.isEnding && !activeBeat.chosenText && dicePhase === "idle" && (
                <motion.div
                  key="choices"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
                  className="space-y-4 pt-2"
                  onClick={e => e.stopPropagation()}
                >
                  <p className="text-sm text-muted-foreground/70 font-medium">{t.choicePrompt}</p>
                  <div className="space-y-2">
                    {activeBeat.choices.map((choice, idx) => (
                      <Button
                        key={idx}
                        variant="outline"
                        className="w-full text-left h-auto py-3 px-4 justify-start whitespace-normal hover:border-primary/50 hover:bg-primary/5 transition-all"
                        onClick={() => selectChoice(idx, choice)}
                      >
                        <span className="text-primary/60 mr-2 shrink-0 font-mono text-xs">{idx + 1}.</span>
                        <span className="text-sm">{choice}</span>
                      </Button>
                    ))}
                  </div>

                  {/* Skills */}
                  {skills.length > 0 && (
                    <div className="border-t border-border/30 pt-3" onClick={e => e.stopPropagation()}>
                      <SkillsBar
                        skills={skills}
                        selectedSkillId={selectedSkillId}
                        onSelect={setSelectedSkillId}
                        disabled={false}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Dice roll panel ── */}
            <AnimatePresence>
              {(dicePhase === "ready" || dicePhase === "rolling") && pendingChoice && (
                <motion.div
                  key="dice-panel"
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-4 pt-2"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Selected choice */}
                  <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20">
                    <span className="text-primary/60 font-mono text-xs mt-0.5 shrink-0">
                      {pendingChoice.index + 1}.
                    </span>
                    <p className="text-sm text-foreground/90">{pendingChoice.text}</p>
                  </div>

                  {/* Active skill badge */}
                  {activeSkill && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30"
                    >
                      <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-primary">
                        {lang === "ko" ? activeSkill.nameKo : activeSkill.name}
                      </span>
                      <span className="text-xs text-muted-foreground/60 ml-auto">
                        {activeSkill.statBonus.toUpperCase()} +{activeSkill.bonusValue}
                        {activeSkill.hpEffect ? ` · HP ${activeSkill.hpEffect > 0 ? "+" : ""}${activeSkill.hpEffect}` : ""}
                      </span>
                    </motion.div>
                  )}

                  {/* Dice */}
                  <div className="flex flex-col items-center gap-4 py-4">
                    {dicePhase === "rolling" ? (
                      <>
                        <DiceAnimation />
                        <p className="text-sm text-muted-foreground/60 animate-pulse">
                          {lang === "ko" ? "주사위를 굴리는 중..." : "Rolling the die..."}
                        </p>
                      </>
                    ) : (
                      <>
                        <motion.div
                          whileHover={{ scale: 1.05, rotate: 5 }}
                          whileTap={{ scale: 0.95, rotate: -5 }}
                          className="flex items-center justify-center w-16 h-16 rounded-xl border-2 border-primary/50 bg-primary/10 text-primary/70 cursor-pointer"
                          onClick={rollDice}
                        >
                          <Dices className="w-8 h-8" />
                        </motion.div>
                        <div className="flex items-center gap-3">
                          <Button onClick={rollDice} className="gap-2 px-6" size="lg">
                            <Dices className="w-4 h-4" />
                            {lang === "ko" ? "d20 굴리기!" : "Roll d20!"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelChoice} className="text-muted-foreground">
                            {lang === "ko" ? "취소" : "Cancel"}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground/50">
                          {lang === "ko"
                            ? "주사위를 굴려 행동의 결과를 결정하세요"
                            : "Roll to determine the outcome of your action"}
                        </p>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading (no dice) */}
            {choiceMutation.isPending && dicePhase === "idle" && (
              <div className="flex items-center gap-2 text-muted-foreground/50 text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="animate-pulse">{t.loadingStory}</span>
              </div>
            )}

            {/* Ending */}
            {isEnded && allRevealed && (
              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="pt-6 space-y-4 text-center"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-center">
                  {isDead
                    ? <Skull className="w-10 h-10 text-red-400/70" />
                    : <Trophy className="w-10 h-10 text-primary/70" />}
                </div>
                <div>
                  <p className="font-serif text-lg font-medium">{isDead ? t.deathTitle : t.endingTitle}</p>
                  <p className="text-sm text-muted-foreground">{isDead ? t.deathSubtitle : t.endingSubtitle}</p>
                </div>
                <Button variant="outline" onClick={() => setLocation("/")}>
                  <BookOpen className="w-4 h-4 mr-2" />
                  {t.beginNewChronicle}
                </Button>
              </motion.div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
