import { useEffect, useRef, useState } from 'react'
import { useAudio } from '../audio/AudioProvider'
import { useI18n } from '../i18n'

/** Éléments mis en lumière sur l'écran d'un dossier (coordonnées du design) et position de la bulle. */
const STEPS: { rect: { x: number; y: number; w: number; h: number }; pop: { top?: number; bottom?: number } }[] = [
  { rect: { x: 40, y: 301, w: 174, h: 102 }, pop: { top: 424 } }, // piste (à gauche)
  { rect: { x: 213, y: 301, w: 174, h: 102 }, pop: { top: 424 } }, // indice (à droite)
  { rect: { x: 100, y: 422, w: 228, h: 114 }, pop: { top: 560 } }, // révéler
  { rect: { x: 100, y: 605, w: 228, h: 76 }, pop: { bottom: 932 - 592 } }, // saisir la solution
]
const POP_W = 330
const POP_X = (430 - POP_W) / 2

/**
 * Tutoriel affiché à la première ouverture d'un dossier : le bouton expliqué est mis en lumière,
 * le reste de l'écran est assombri, et une bulle dit à quoi il sert (indice, piste, révéler, solution).
 */
export function InvestigationTutorial({ onDone }: { onDone: () => void }) {
  const { ui } = useI18n()
  const { play } = useAudio()
  const [i, setI] = useState(0)
  const next = useRef<HTMLButtonElement>(null)
  const step = STEPS[i]
  const text = ui.tutorial[i]
  const last = i === STEPS.length - 1
  // La flèche de la bulle pointe vers le centre de l'élément en lumière.
  const arrowX = Math.min(POP_W - 34, Math.max(34, step.rect.x + step.rect.w / 2 - POP_X))
  const above = step.pop.bottom !== undefined

  const advance = () => {
    play('button')
    if (last) onDone()
    else setI(i + 1)
  }
  const skip = () => {
    play('button')
    onDone()
  }

  useEffect(() => {
    next.current?.focus()
  }, [i])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  return (
    <div className="tut" role="dialog" aria-modal="true" aria-label={text.title}>
      <div className="tut-block" />
      <div className="tut-spot" style={{ left: step.rect.x - 4, top: step.rect.y - 4, width: step.rect.w + 8, height: step.rect.h + 8 }} />
      <div className={`tut-pop${above ? ' tut-pop--above' : ''}`} style={{ left: POP_X, width: POP_W, ...step.pop }}>
        <span className="tut-arrow" style={{ left: arrowX - 9 }} />
        <p className="tut-title">{text.title}</p>
        <p className="tut-text">{text.text}</p>
        <div className="tut-foot">
          <button type="button" className="tut-skip" onClick={skip} disabled={last} style={{ visibility: last ? 'hidden' : 'visible' }}>
            {ui.tutorialSkip}
          </button>
          <span className="tut-dots" aria-hidden="true">
            {STEPS.map((_, k) => (
              <i key={k} className={k === i ? 'on' : ''} />
            ))}
          </span>
          <button type="button" className="tut-next" ref={next} onClick={advance}>
            {last ? ui.tutorialDone : ui.tutorialNext}
          </button>
        </div>
      </div>
    </div>
  )
}
