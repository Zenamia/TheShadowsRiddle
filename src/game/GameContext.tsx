import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { loadCloud, saveCloud } from './cloud'
import { isLang, type Lang } from '../i18n/lang'
import { CASE_COUNT, HINT_PENALTY, REVEAL_PENALTY, TOTAL_SECONDS } from './data'

export type Screen =
  | { name: 'title' | 'language' | 'signin' | 'continue' | 'instructions' | 'rules' | 'loading' | 'welcome' | 'files' | 'epilogue' | 'score' | 'end' }
  | { name: 'story' | 'invest' | 'hint' | 'puzzle' | 'confirm' | 'solution' | 'solved'; n: number }

export interface GameState {
  screen: Screen
  /** Langue de la partie (choisie au lancement d'une nouvelle partie, puis enregistrée avec elle). */
  lang: Lang
  team: string
  /** Le nom d'équipe a été validé : c'est lui qui retrouve la partie, sur n'importe quel appareil. */
  confirmed: boolean
  startedAt: number | null
  finishedAt: number | null
  /** Temps de jeu réel en ms : ne compte que lorsque l'appli est ouverte et visible (onglet fermé ou en arrière-plan = pas de temps). */
  playMs: number
  solved: number[]
  hintsOpened: number[]
  revealed: number[]
  /** Tous les dossiers sont ouverts (code d'équipe spécial). */
  unlockAll: boolean
  /** Le tutoriel des boutons d'un dossier (indice, piste, révéler) a été vu. */
  tutorialSeen: boolean
  /** Date de la dernière modification : la version la plus récente l'emporte entre appareil et serveur. */
  savedAt: number
}

type Action =
  | { type: 'go'; screen: Screen }
  | { type: 'lang'; lang: Lang }
  | { type: 'team'; team: string }
  | { type: 'start' }
  | { type: 'hint'; n: number }
  | { type: 'reveal'; n: number }
  | { type: 'tutorial' }
  | { type: 'tick'; ms: number }
  | { type: 'solve'; n: number }
  | { type: 'newTeam'; team: string; unlockAll: boolean }
  | { type: 'unlock'; team: string }
  | { type: 'replace'; state: GameState }
  | { type: 'reset' }

const KEY = 'enigmarena:game:v1'
const INITIAL: GameState = {
  screen: { name: 'title' },
  lang: 'en',
  team: '',
  confirmed: false,
  startedAt: null,
  finishedAt: null,
  playMs: 0,
  solved: [],
  hintsOpened: [],
  revealed: [],
  unlockAll: false,
  tutorialSeen: false,
  savedAt: 0,
}

const add = (list: number[], n: number) => (list.includes(n) ? list : [...list, n])

function step(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'go':
      return { ...s, screen: a.screen }
    case 'lang':
      return { ...s, lang: a.lang }
    case 'team':
      return { ...s, team: a.team, confirmed: false }
    case 'start':
      return s.startedAt ? s : { ...s, startedAt: Date.now() }
    case 'hint':
      return { ...s, hintsOpened: add(s.hintsOpened, a.n) }
    case 'reveal':
      return { ...s, revealed: add(s.revealed, a.n) }
    case 'tutorial':
      return s.tutorialSeen ? s : { ...s, tutorialSeen: true }
    case 'tick':
      return { ...s, playMs: s.playMs + a.ms }
    case 'solve': {
      const solved = add(s.solved, a.n)
      const done = solved.length === CASE_COUNT
      return { ...s, solved, finishedAt: done && !s.finishedAt ? Date.now() : s.finishedAt }
    }
    case 'newTeam':
      return { ...INITIAL, lang: s.lang, team: a.team, unlockAll: a.unlockAll, confirmed: true, screen: { name: 'instructions' } }
    case 'unlock':
      // Code d'équipe spécial : partie déjà lancée, tous les dossiers ouverts, directement au hub.
      return { ...INITIAL, lang: s.lang, team: a.team, unlockAll: true, confirmed: true, startedAt: Date.now(), screen: { name: 'files' } }
    case 'replace':
      return a.state
    case 'reset':
      return { ...INITIAL, lang: s.lang }
  }
}

function reducer(s: GameState, a: Action): GameState {
  const next = step(s, a)
  // Une reprise venant du serveur garde sa propre date ; toute autre action date la modification.
  return a.type === 'replace' || a.type === 'tick' ? next : { ...next, savedAt: Date.now() }
}

/** Reprise d'une sauvegarde reçue : on repart du hub (ou des instructions si la partie n'a pas commencé). */
/** Anciennes sauvegardes : le temps de jeu était l'écart entre le début et la fin (ou maintenant). */
const legacyPlayMs = (s: Partial<GameState>) => (s.startedAt ? Math.max(0, (s.finishedAt ?? Date.now()) - s.startedAt) : 0)

export function resume(s: GameState): GameState {
  return { ...INITIAL, ...s, playMs: typeof s.playMs === 'number' ? s.playMs : legacyPlayMs(s), lang: isLang(s.lang) ? s.lang : 'en', confirmed: true, screen: { name: s.startedAt ? 'files' : 'instructions' } }
}

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return INITIAL
    const s = { ...INITIAL, ...JSON.parse(raw) } as GameState
    if (typeof JSON.parse(raw).playMs !== 'number') s.playMs = legacyPlayMs(s)
    // L'écran de chargement est transitoire : on reprend au hub si la partie est lancée.
    if (s.screen.name === 'loading') s.screen = { name: s.startedAt ? 'files' : 'rules' }
    return s
  } catch {
    return INITIAL
  }
}

export interface Report {
  timeUsed: number
  hints: number
  reveals: number
  penalty: number
  timeLeft: number
  score: number
}

export function reportFor(s: GameState): Report {
  const timeUsed = s.startedAt ? Math.max(0, Math.round(s.playMs / 1000)) : 0
  const hints = s.hintsOpened.length
  const reveals = s.revealed.length
  const penalty = hints * HINT_PENALTY + reveals * REVEAL_PENALTY
  const timeLeft = Math.max(0, TOTAL_SECONDS - timeUsed - penalty)
  return { timeUsed, hints, reveals, penalty, timeLeft, score: timeLeft }
}

interface GameApi {
  state: GameState
  go: (screen: Screen) => void
  setLang: (lang: Lang) => void
  setTeam: (team: string) => void
  start: () => void
  openHint: (n: number) => void
  reveal: (n: number) => void
  /** Marque le tutoriel comme vu. */
  endTutorial: () => void
  solve: (n: number) => void
  reset: () => void
  /** Démarre une nouvelle partie sous ce nom d'équipe (efface la partie locale d'une autre équipe). */
  newTeam: (team: string, unlockAll: boolean) => void
  /** Code d'équipe spécial : ouvre tous les dossiers, sans sauvegarde préalable. */
  unlockTeam: (team: string) => void
  /** Remplace la partie par une sauvegarde retrouvée sur le serveur. */
  restore: (state: GameState) => void
  /** Prochain dossier à ouvrir (1..14), ou 15 quand tout est résolu. */
  current: number
}

const Ctx = createContext<GameApi | null>(null)

const SYNC_DELAY_MS = 900
/** Le temps de jeu est ajouté à l'état toutes les 5 s ; on ne compte jamais plus de 30 s d'un coup (veille de l'appareil). */
const TICK_MS = 5000
const MAX_TICK_MS = 30000

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)
  const latest = useRef(state)
  latest.current = state

  // Décompte du temps de jeu : seulement quand l'appli est ouverte ET visible (et la partie lancée, non terminée).
  const since = useRef<number | null>(null)
  const pending = () => (since.current === null ? 0 : Math.min(Date.now() - since.current, MAX_TICK_MS))
  /** État courant avec le temps de jeu à la milliseconde près (pour les sauvegardes). */
  const snapshot = useCallback((): GameState => ({ ...latest.current, playMs: latest.current.playMs + pending() }), [])
  const commit = useCallback(() => {
    const ms = pending()
    since.current = since.current === null ? null : Date.now()
    if (ms > 0) dispatch({ type: 'tick', ms })
  }, [])
  const isRunning = () => document.visibilityState === 'visible' && !!latest.current.startedAt && !latest.current.finishedAt
  useEffect(() => {
    const reconcile = () => {
      commit()
      since.current = isRunning() ? Date.now() : null
    }
    reconcile()
    const timer = window.setInterval(commit, TICK_MS)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [commit])
  // La partie démarre / se termine : on (re)cale le décompte.
  useEffect(() => {
    commit()
    since.current = isRunning() ? Date.now() : null
  }, [state.startedAt, state.finishedAt, commit])

  // Copie locale : sert uniquement à reprendre la session en cours après un rechargement.
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* stockage indisponible : la partie reste jouable */
    }
  }, [state])

  // Sauvegarde en ligne sous le nom d'équipe, peu après chaque changement (le simple décompte du temps n'en déclenche pas).
  useEffect(() => {
    if (!state.confirmed || !state.team) return
    const id = window.setTimeout(async () => {
      const r = await saveCloud(snapshot())
      if (r.status === 'conflict') adopt(r.state) // une version plus récente existe (autre appareil)
    }, SYNC_DELAY_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt, state.confirmed, state.team])

  // Dernière écriture avant de quitter / de passer en arrière-plan : temps de jeu compris.
  useEffect(() => {
    const flush = () => {
      const s = snapshot()
      try {
        localStorage.setItem(KEY, JSON.stringify(s))
      } catch {
        /* stockage indisponible */
      }
      if (s.confirmed && s.team) void saveCloud(s, true)
    }
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [snapshot])

  // Au démarrage : si le serveur a une version plus récente de cette équipe (jouée ailleurs), on la reprend.
  useEffect(() => {
    const s = latest.current
    if (!s.confirmed || !s.team) return
    let cancelled = false
    loadCloud(s.team).then((r) => {
      if (!cancelled && r.status === 'found' && r.state.savedAt > latest.current.savedAt) adopt(r.state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const adopt = useCallback((s: GameState) => {
    const r = resume(s)
    // Le décompte repart du temps de la sauvegarde reçue.
    since.current = document.visibilityState === 'visible' && r.startedAt && !r.finishedAt ? Date.now() : null
    dispatch({ type: 'replace', state: r })
  }, [])
  const go = useCallback((screen: Screen) => dispatch({ type: 'go', screen }), [])
  const api = useMemo<GameApi>(() => {
    let current = 1
    while (state.solved.includes(current) && current <= CASE_COUNT) current++
    return {
      state,
      go,
      current,
      setLang: (lang) => dispatch({ type: 'lang', lang }),
      setTeam: (team) => dispatch({ type: 'team', team }),
      start: () => dispatch({ type: 'start' }),
      openHint: (n) => dispatch({ type: 'hint', n }),
      reveal: (n) => dispatch({ type: 'reveal', n }),
      endTutorial: () => dispatch({ type: 'tutorial' }),
      solve: (n) => dispatch({ type: 'solve', n }),
      reset: () => {
        since.current = null
        dispatch({ type: 'reset' })
      },
      newTeam: (team, unlockAll) => {
        since.current = null // nouvelle partie : le temps repart de zéro
        dispatch({ type: 'newTeam', team, unlockAll })
      },
      unlockTeam: (team) => {
        since.current = null
        dispatch({ type: 'unlock', team })
      },
      restore: (s) => adopt(s),
    }
  }, [state, go])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useGame() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGame doit être utilisé dans <GameProvider>')
  return ctx
}
