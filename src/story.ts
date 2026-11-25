export const CLASS_NAMES = {
  en: { melee: 'Cardsharp', mage: 'Mage', archer: 'Archer' },
  es: { melee: 'Cartista', mage: 'Mago', archer: 'Arquero' }
}

export const BOSS_FORM_NAMES = {
  en: { f1: 'Rehearsal', f2: 'Plot', f3: 'Company', f4: 'Puppeteer' },
  es: { f1: 'Ensayo', f2: 'Trama', f3: 'Compañía', f4: 'Titiritera' }
}

export const PUPPET_NAMES = {
  en: { rehearsal: 'Rehearsal Puppet', knight: 'Knight', princess: 'Princess', dragon: 'Dragon' },
  es: { rehearsal: 'Títere de ensayo', knight: 'Caballero', princess: 'Princesa', dragon: 'Dragón' }
}

export const PHASE_NAMES = {
  en: {
    onboarding: 'The curtain rises',
    f1: `I / ${BOSS_FORM_NAMES.en.f1}`,
    f2: `II / ${BOSS_FORM_NAMES.en.f2}`,
    f3: `III / ${BOSS_FORM_NAMES.en.f3}`,
    f4: `IV / ${BOSS_FORM_NAMES.en.f4}`,
    victory: 'The final bow',
    defeat: 'The curtain falls',
    timeout: 'The curtain falls'
  },
  es: {
    onboarding: 'Se abre el telón',
    f1: `I / ${BOSS_FORM_NAMES.es.f1}`,
    f2: `II / ${BOSS_FORM_NAMES.es.f2}`,
    f3: `III / ${BOSS_FORM_NAMES.es.f3}`,
    f4: `IV / ${BOSS_FORM_NAMES.es.f4}`,
    victory: 'La última reverencia',
    defeat: 'Cae el telón',
    timeout: 'Cae el telón'
  }
}

export const STORY_CUES = {
  en: {
    choose_class: 'Select a class below or walk toward the cast.',
    first_hit: 'Hit the glowing knot to start. That hit counts.',
    fight_start: 'Dodge the boss. Hit the knot when it glows.',
    cut_knot: 'Cut the red knot when it hangs exposed.',
    read_controller: 'Wait for the knot to glow, then strike.',
    lure_puppet: 'Defeat the puppet. Crimson wires stun it.',
    call_company: 'Defeat the cast. Step on the marks to gather them.',
    wrap_thread: 'When tethered, circle the fallen controller.',
    pull_own_strings: 'She steals the strings. One puppet wakes.',
    controller_cracks: 'She rises and takes hold of the entire cast.',
    cut_strings: 'The cross falls. She reaches for your strings.',
    respawning: 'Back on stage. Your progress is safe.',
    failsafe: 'Last chance. Cut the remaining threads.',
    climax: 'Final act. Half a turn catches her thread.',
    open: 'The knot is open. Aim and cut.',
    free: 'The last thread falls. She takes her bow.',
    manual_clear: 'The final thread snaps. The cast is free.',
    assisted_clear: 'With the theatre’s help, you freed the cast.',
    defeat: 'Three knockouts. The puppeteer takes your strings.',
    timeout: 'The curtain falls. The puppeteer keeps the cast.'
  },
  es: {
    choose_class: 'Elige una clase abajo o acércate al elenco.',
    first_hit: 'Golpea el nudo iluminado para empezar. Ese impacto cuenta.',
    fight_start: 'Esquiva a la jefa. Ataca cuando se ilumine el nudo.',
    cut_knot: 'Corta el nudo rojo cuando quede expuesto.',
    read_controller: 'Espera a que el nudo se ilumine y ataca.',
    lure_puppet: 'Derrota al títere. Los hilos carmesí lo aturden.',
    call_company: 'Derrota al elenco. Pisa las marcas para reunirlo.',
    wrap_thread: 'Cuando te ate, rodea la cruceta caída.',
    pull_own_strings: 'Roba los hilos. Un títere despierta.',
    controller_cracks: 'Se eleva y toma el control de todo el elenco.',
    cut_strings: 'Cae la cruceta. Ahora va por tus hilos.',
    respawning: 'De vuelta al escenario. Conservas tu avance.',
    failsafe: 'Última oportunidad. Rompe los hilos que faltan.',
    climax: 'Último acto. Media vuelta enreda su hilo.',
    open: 'El nudo está abierto. Apunta y corta.',
    free: 'Cae el último hilo. Ella hace una reverencia.',
    manual_clear: 'Se rompe el último hilo. El elenco queda libre.',
    assisted_clear: 'Con ayuda del teatro, liberaste al elenco.',
    defeat: 'Tres caídas o noqueos. La titiritera toma tus hilos.',
    timeout: 'Cae el telón. La titiritera se queda con el elenco.'
  }
}
