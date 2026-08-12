// The conversations of Halden.
//
// Data, not logic. Every node is: something you may say, when you may say it,
// what they answer, and what it changes. The engine is src/game/dialogue.js and
// the validator is in tools/test.js — between them, adding a conversation is
// writing this file and nothing else.
//
// House rules for writing one:
//   · Nobody explains the world to you unprompted. You ask.
//   · A trainer names a price and does not haggle.
//   · At least one door in every conversation closes behind you.

export const DIALOGUE = {
  // --- Harl, the smith -------------------------------------------------------
  harl_smith: [
    {
      id: 'harl.greet',
      text: 'Good morning.',
      reply: 'It was. Then the ore wagon came up two crates short and here we are.',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:harl' }],
    },
    {
      id: 'harl.ore',
      when: (c) => c.has('met:harl'),
      text: 'Two crates short — stolen?',
      reply: 'Taken on the farm road past the fork, and the Watch says wolves. Wolves do not carry crates.',
      once: true,
      effects: [{ kind: 'flag', flag: 'knows:ore_theft' }, { kind: 'quest', quest: 'q_ore', stage: 'told' }],
    },
    {
      id: 'harl.train_ask',
      when: (c) => c.has('met:harl'),
      text: 'Could you teach me to hold a sword properly?',
      reply: 'You hold it like a man carrying a hot pan. Two hundred coin and I will fix that.',
      once: true,
      effects: [{ kind: 'flag', flag: 'harl:offered' }],
    },
    {
      id: 'harl.train',
      when: (c) => c.has('harl:offered') && c.gold >= 200,
      text: 'Here is the two hundred. Teach me.',
      reply: 'Elbow down. Weight on the back foot. Again.',
      effects: [
        { kind: 'gold', amount: -200 },
        { kind: 'trainer', skill: 'oneHanded', max: 45, step: 5 },
      ],
    },
    {
      id: 'harl.train_poor',
      when: (c) => c.has('harl:offered') && c.gold < 200,
      text: 'I will have the two hundred soon.',
      reply: 'Then we will talk soon.',
    },
    {
      id: 'harl.trade',
      when: (c) => c.has('met:harl'),
      text: 'What have you got to sell?',
      reply: 'What is on the rack. I do not haggle and I do not buy rubbish.',
      effects: [{ kind: 'trade', trader: 'harl_smith' }],
    },
    {
      id: 'harl.ore_solved',
      when: (c) => c.has('quest:q_ore:found'),
      text: 'I found your crates. Bandits, not wolves.',
      reply: 'I knew it. Take this — and tell the Watch yourself, they will not hear it from a smith.',
      once: true,
      effects: [
        { kind: 'take', item: 'ore_crate' },
        { kind: 'gold', amount: 150 },
        { kind: 'xp', amount: 250 },
        { kind: 'quest', quest: 'q_ore', stage: 'done' },
        { kind: 'flag', flag: 'harl:trusts' },
      ],
    },
    {
      id: 'harl.forge',
      when: (c) => c.has('harl:trusts') && c.gold >= 300,
      text: 'Forge me a proper blade. Three hundred.',
      reply: 'Come back at dusk. — He does not look up when he hands it over.',
      once: true,
      effects: [
        { kind: 'gold', amount: -300 },
        { kind: 'give', item: 'forged_blade' },
        { kind: 'xp', amount: 150 },
      ],
    },
    { id: 'harl.leave', text: 'Another time.', reply: 'Mind the anvil.', ends: true, priority: -100 },
  ],

  // --- Bosk, the hunter ------------------------------------------------------
  bosk_hunter: [
    {
      id: 'bosk.greet',
      text: 'You hunt out here?',
      reply: 'When the wood lets me. It has not, lately.',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:bosk' }],
    },
    {
      id: 'bosk.wolves',
      when: (c) => c.has('met:bosk'),
      text: 'What is wrong with the wood?',
      reply: 'Wolves in numbers, and bolder than wolves have a right to be. Something moved them.',
      once: true,
      effects: [{ kind: 'flag', flag: 'knows:wolves' }, { kind: 'quest', quest: 'q_wolves', stage: 'told' }],
    },
    {
      id: 'bosk.bow',
      when: (c) => c.has('knows:wolves'),
      text: 'Teach me the bow and I will thin them.',
      reply: 'A hundred and fifty, and you nock it yourself until your fingers bleed.',
      once: true,
      effects: [{ kind: 'flag', flag: 'bosk:offered' }],
    },
    {
      id: 'bosk.bow_buy',
      when: (c) => c.has('bosk:offered') && c.gold >= 150,
      text: 'Done. A hundred and fifty.',
      reply: 'Draw to the cheek, not the chin.',
      effects: [
        { kind: 'gold', amount: -150 },
        { kind: 'trainer', skill: 'bow', max: 40, step: 5 },
      ],
    },
    {
      id: 'bosk.skinning',
      when: (c) => c.has('met:bosk') && !c.knows('skinning'),
      text: 'And the trick of taking a hide without ruining it?',
      reply: 'That one is free. Nobody should waste a wolf.',
      once: true,
      effects: [{ kind: 'trainer', skill: 'skinning', free: true }],
    },
    {
      id: 'bosk.trade',
      when: (c) => c.has('met:bosk'),
      text: 'Do you buy hides?',
      reply: 'I buy what I can sell in Halden. Pelts, tusks, and nothing with a curse on it.',
      effects: [{ kind: 'trade', trader: 'bosk_hunter' }],
    },
    {
      id: 'bosk.done',
      when: (c) => c.has('quest:q_wolves:cleared'),
      text: 'The pack by the mill is dead.',
      reply: 'Then I can work. Here — I keep coin for people who do what they say.',
      once: true,
      effects: [
        { kind: 'gold', amount: 120 },
        { kind: 'xp', amount: 300 },
        { kind: 'quest', quest: 'q_wolves', stage: 'done' },
      ],
    },
    { id: 'bosk.leave', text: 'Good hunting.', reply: 'And to you.', ends: true, priority: -100 },
  ],

  // --- A gate guard: the guild door ------------------------------------------
  watch_gate: [
    {
      id: 'watch.greet',
      text: 'Who keeps this gate?',
      reply: 'The Watch keeps it. You keep moving.',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:watch' }],
    },
    {
      id: 'watch.join_ask',
      when: (c) => c.has('met:watch') && !c.guild,
      text: 'How does a man join the Watch?',
      reply: 'He does not ask a gate guard. He does something the captain hears about.',
      once: true,
      effects: [{ kind: 'flag', flag: 'watch:asked' }],
    },
    {
      id: 'watch.join',
      when: (c) => c.has('watch:asked') && c.has('harl:trusts') && !c.guild,
      text: 'The smith will vouch for me. The ore was bandits, and I can prove it.',
      reply: 'Then the captain will hear it from me. Stand in the line tomorrow — and understand that '
        + 'once you do, the mages and the Freeblades have no use for you.',
      once: true,
      effects: [{ kind: 'guild', guild: 'watch' }, { kind: 'xp', amount: 400 }],
    },
    {
      id: 'watch.sworn',
      when: (c) => c.guild === 'watch',
      text: 'Anything on the farm road today?',
      reply: 'Nothing the two of us cannot handle.',
    },
    {
      id: 'watch.other_guild',
      when: (c) => c.guild && c.guild !== 'watch',
      text: 'I have taken another oath.',
      reply: 'Then we have nothing to discuss.',
    },
    { id: 'watch.leave', text: 'Carry on.', reply: 'Move along.', ends: true, priority: -100 },
  ],
};

/** Which NPC id speaks which conversation. */
export const SPEAKERS = {
  npc0: 'watch_gate',
  npc1: 'bosk_hunter',
  npc3: 'harl_smith',
};
