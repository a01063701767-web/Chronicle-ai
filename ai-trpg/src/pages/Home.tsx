import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sword, ScrollText, Skull, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";

const GENRE_KEYS = ["fantasy", "dark fantasy", "sci-fi", "horror", "western"] as const;

const CLASSES = {
  en: [
    { name: "Warrior",     hint: "Sole survivor of a slaughtered regiment. The fortress is falling." },
    { name: "Rogue",       hint: "You stole something you shouldn't have. Dawn is one hour away." },
    { name: "Mage",        hint: "Trapped inside a sealed tower. Something inside woke up." },
    { name: "Paladin",     hint: "Sent to investigate a cathedral gone silent. Something breathes in the dark." },
    { name: "Ranger",      hint: "Three days tracking a creature. The trail ends at a strange symbol." },
    { name: "Necromancer", hint: "Your ritual went wrong. Something older answered. The crypt sealed itself." },
    { name: "Bard",        hint: "You overheard a war secret. Both generals saw your face." },
    { name: "Druid",       hint: "The land screamed three nights ago. You followed the wound here." },
  ],
  ko: [
    { name: "전사",       hint: "부대가 전멸했고, 살아남은 건 당신뿐. 요새가 무너지고 있다." },
    { name: "도적",       hint: "훔쳐선 안 될 것을 훔쳤다. 새벽까지 한 시간." },
    { name: "마법사",     hint: "봉인된 탑에 갇혔다. 주문이 무언가를 깨웠다." },
    { name: "성기사",     hint: "기도가 침묵한 성당을 조사하러 왔다. 어둠 속에서 무언가가 숨 쉰다." },
    { name: "레인저",     hint: "사흘째 추적. 발자국이 이상한 문양 앞에서 끊겼다." },
    { name: "사령술사",   hint: "의식이 틀어졌다. 훨씬 오래된 것이 응답했다. 납골당이 봉인됐다." },
    { name: "음유시인",   hint: "전쟁을 끝낼 비밀을 엿들었다. 두 장군 모두 당신 얼굴을 봤다." },
    { name: "드루이드",   hint: "사흘 전 대지가 비명을 질렀다. 상처를 따라 여기까지 왔다." },
  ],
};

const REQUIRE_CLASS_EN  = "Select a class to begin";
const REQUIRE_CLASS_KO  = "직업을 선택하세요";
const REQUIRE_GENRE_EN  = "Select a genre to begin";
const REQUIRE_GENRE_KO  = "장르를 선택하세요";

export default function Home() {
  const [, setLocation] = useLocation();
  const { lang, t } = useLang();
  const [playerName, setPlayerName] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [attempted, setAttempted] = useState(false);

  const classes = CLASSES[lang];

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/game/start", {
        genre: selectedGenre,
        characterClass: selectedClass,
        playerName: playerName.trim(),
        lang,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/game/${data.sessionId}`);
    },
  });

  const selectedClassInfo = classes.find(c => c.name === selectedClass);
  const canStart = !!selectedClass && !!selectedGenre;

  const handleStart = () => {
    setAttempted(true);
    if (!canStart) return;
    startMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/40 px-4 py-3 flex justify-end">
        <LangToggle />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          {/* Title */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 mb-4">
              <ScrollText className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-4xl font-serif font-bold text-foreground tracking-wide">
              {t.appName}
            </h1>
            <p className="text-muted-foreground text-sm">{t.appTagline}</p>
            <p className="text-muted-foreground/60 text-xs">{t.appSub}</p>
          </div>

          <div className="space-y-5">
            {/* Player Name */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground/70">{t.characterName}</Label>
              <Input
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder={t.characterNamePlaceholder}
                className="bg-card border-border/60"
              />
            </div>

            {/* Class */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground/70">
                {t.classLabel}
                <span className="text-red-400 ml-1">*</span>
              </Label>
              <Select value={selectedClass} onValueChange={v => { setSelectedClass(v); setAttempted(false); }}>
                <SelectTrigger className={`bg-card border-border/60 ${attempted && !selectedClass ? "border-red-500/60" : ""}`}>
                  <SelectValue placeholder={t.classPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => (
                    <SelectItem key={c.name} value={c.name}>
                      <div className="flex items-center gap-2">
                        <Sword className="w-3.5 h-3.5 text-primary shrink-0" />
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {attempted && !selectedClass && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {lang === "ko" ? REQUIRE_CLASS_KO : REQUIRE_CLASS_EN}
                </p>
              )}
              {selectedClassInfo && (
                <p className="text-xs text-muted-foreground/70 italic px-1">
                  {selectedClassInfo.hint}
                </p>
              )}
            </div>

            {/* Genre */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground/70">
                {t.genreLabel}
                <span className="text-red-400 ml-1">*</span>
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {GENRE_KEYS.map(key => {
                  const g = t.genres[key];
                  return (
                    <button
                      key={key}
                      onClick={() => { setSelectedGenre(key); setAttempted(false); }}
                      className={`text-left px-4 py-3 rounded-lg border transition-all ${
                        selectedGenre === key
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : attempted && !selectedGenre
                            ? "border-red-500/30 bg-card text-muted-foreground hover:text-foreground"
                            : "border-border/40 bg-card hover:border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="font-medium text-sm">{g.label}</div>
                      <div className="text-xs text-muted-foreground/70 mt-0.5">{g.description}</div>
                    </button>
                  );
                })}
              </div>
              {attempted && !selectedGenre && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {lang === "ko" ? REQUIRE_GENRE_KO : REQUIRE_GENRE_EN}
                </p>
              )}
            </div>
          </div>

          {/* Begin button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleStart}
            disabled={startMutation.isPending}
          >
            {startMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t.beginningButton}
              </>
            ) : (
              <>
                <Skull className="w-4 h-4 mr-2" />
                {t.beginButton}
              </>
            )}
          </Button>

          {startMutation.isError && (
            <p className="text-sm text-red-400 text-center">{t.startError}</p>
          )}

          <p className="text-center text-xs text-muted-foreground/40">{t.poweredBy}</p>
        </div>
      </main>
    </div>
  );
}
