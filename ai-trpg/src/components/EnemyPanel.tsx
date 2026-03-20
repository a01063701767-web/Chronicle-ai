import { memo, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Enemy, EnemyChanges } from "@/types";
import { Sword, Shield, Skull } from "lucide-react";

type Props = { enemy: Enemy; changes?: EnemyChanges };

type FloatingNum = { id: number; value: number };

const EnemyHpBar = memo(function EnemyHpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct   = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const color = pct > 50 ? "bg-red-700" : pct > 25 ? "bg-red-600" : "bg-red-500 animate-pulse";
  return (
    <div className="w-full h-2 bg-muted/60 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
});

export const EnemyPanel = memo(function EnemyPanel({ enemy, changes }: Props) {
  const [floatingNums, setFloatingNums] = useState<FloatingNum[]>([]);
  const nextId  = useRef(0);
  const prevHp  = useRef(enemy.hp);

  useEffect(() => {
    const delta = enemy.hp - prevHp.current;
    prevHp.current = enemy.hp;
    if (delta !== 0) {
      const id = nextId.current++;
      setFloatingNums(prev => [...prev, { id, value: delta }]);
      setTimeout(() => setFloatingNums(prev => prev.filter(n => n.id !== id)), 1800);
    }
  }, [enemy.hp]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.3 }}
      className="border-b border-red-900/40 bg-red-950/20 backdrop-blur-sm"
    >
      <div className="relative max-w-3xl mx-auto px-4 py-3">

        {/* Floating damage numbers */}
        <AnimatePresence>
          {floatingNums.map(n => (
            <motion.div
              key={n.id}
              initial={{ opacity: 1, y: 0, scale: 1.2 }}
              animate={{ opacity: 0, y: -40, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className={`pointer-events-none absolute top-0 right-8 text-2xl font-black drop-shadow-lg z-20 ${
                n.value < 0 ? "text-red-300" : "text-green-400"
              }`}
            >
              {n.value < 0 ? n.value : `+${n.value}`}
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          {/* Enemy icon */}
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-900/40 border border-red-800/40 shrink-0">
            <Skull className="w-4.5 h-4.5 text-red-400" />
          </div>

          {/* Name + HP bar */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-serif font-bold text-red-200 truncate">{enemy.name}</span>
              <span className="text-xs tabular-nums text-red-300/80 shrink-0">
                <motion.span
                  key={enemy.hp}
                  initial={{ scale: 1.4 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.25, type: "spring", stiffness: 300 }}
                  className="inline-block font-bold"
                >
                  {enemy.hp}
                </motion.span>
                <span className="text-red-400/50">/{enemy.maxHp}</span>
              </span>
            </div>
            <EnemyHpBar hp={enemy.hp} maxHp={enemy.maxHp} />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 text-xs text-red-300/70">
              <Sword className="w-3 h-3" />
              <span className="font-semibold tabular-nums">{enemy.attack}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-red-300/70">
              <Shield className="w-3 h-3" />
              <span className="font-semibold tabular-nums">{enemy.defense}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
