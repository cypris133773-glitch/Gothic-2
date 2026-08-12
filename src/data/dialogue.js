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

  // --- The gate of the upper quarter -----------------------------------------
  //
  // The most important conversation in the game, and the one every other piece
  // of the design exists to make possible. Two guards, and four honest ways
  // past them: somebody's errand, an oath, money, or the wall. None of them is
  // a key and none of them is a cutscene — the gate is a door in the world and
  // it stays shut until one of the four is true.
  watch_gate: [
    {
      id: 'watch.greet',
      text: 'I would go up.',
      reply: 'You would not. Upper quarter is for people with business in it.',
      once: true, priority: 100,
      effects: [
        { kind: 'flag', flag: 'met:watch' },
        { kind: 'quest', quest: 'q_upper', stage: 'refused' },
      ],
    },
    {
      id: 'watch.what_business',
      when: (c) => c.has('met:watch') && !c.has('pass:upper'),
      text: 'What counts as business?',
      reply: 'Sworn to one of the orders. Or carrying something for somebody who lives up there. '
        + 'Or — and I will deny I said it — being generous.',
      once: true,
      effects: [{ kind: 'flag', flag: 'knows:upper_ways' }],
    },
    // 1. an errand for somebody who matters
    {
      id: 'watch.errand',
      when: (c) => c.has('quest:q_letter:carried') && !c.has('pass:upper'),
      text: 'I am carrying Yorne\'s letter to the alchemist. Look at the seal.',
      reply: 'That is Vessa\'s mark. Go on, then — and come straight back down.',
      once: true,
      effects: [
        { kind: 'flag', flag: 'pass:upper' },
        { kind: 'quest', quest: 'q_upper', stage: 'errand' },
        { kind: 'xp', amount: 150 },
      ],
    },
    // 2. an oath
    {
      id: 'watch.sworn_pass',
      when: (c) => !!c.guild && !c.has('pass:upper'),
      text: 'I am sworn. Look at me and decide.',
      reply: 'So you are. Up you go.',
      once: true,
      effects: [
        { kind: 'flag', flag: 'pass:upper' },
        { kind: 'quest', quest: 'q_upper', stage: 'sworn' },
      ],
    },
    // 3. money
    {
      id: 'watch.bribe',
      when: (c) => c.has('knows:upper_ways') && c.gold >= 300 && !c.has('pass:upper'),
      text: 'Three hundred coin says I have business.',
      reply: 'It says something. — He does not count it where anyone can see.',
      once: true,
      effects: [
        { kind: 'gold', amount: -300 },
        { kind: 'flag', flag: 'pass:upper' },
        { kind: 'flag', flag: 'watch:bribed' },
        { kind: 'quest', quest: 'q_upper', stage: 'bribed' },
      ],
    },
    {
      id: 'watch.bribe_poor',
      when: (c) => c.has('knows:upper_ways') && c.gold < 300 && !c.has('pass:upper'),
      text: 'How generous, exactly?',
      reply: 'Three hundred. And do not insult me with less.',
    },
    // 4. the wall — the guard never learns about this one
    {
      id: 'watch.climbed',
      when: (c) => c.has('pass:upper') && c.has('quest:q_upper:climbed'),
      text: 'Morning.',
      reply: '— He looks at you, then at the gate he did not open. He says nothing.',
    },
    {
      id: 'watch.after',
      when: (c) => c.has('pass:upper') && !c.has('quest:q_upper:climbed'),
      text: 'Anything on the farm road today?',
      reply: 'Nothing the two of us cannot handle.',
    },
    { id: 'watch.leave', text: 'Another time.', reply: 'Move along.', ends: true, priority: -100 },
  ],

  // --- Yorne, who keeps the tavern: the errand -------------------------------
  yorne_tavern: [
    {
      id: 'yorne.greet',
      text: 'You keep this house?',
      reply: 'I keep it, I pour it, and I hear everything said in it. What do you want?',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:yorne' }],
    },
    {
      id: 'yorne.upper',
      when: (c) => c.has('met:yorne') && c.has('quest:q_upper:refused') && !c.has('pass:upper'),
      text: 'The gate guards turned me away.',
      reply: 'They turn everyone away. They do not turn away a man carrying Vessa\'s post.',
      once: true,
      effects: [{ kind: 'flag', flag: 'knows:yorne_letter' }],
    },
    {
      id: 'yorne.letter',
      when: (c) => c.has('knows:yorne_letter') && !c.has('quest:q_letter:told'),
      text: 'Then give me her post.',
      reply: 'Sealed, and it stays sealed. Break it and you can explain that to her yourself.',
      once: true,
      effects: [
        { kind: 'give', item: 'sealed_letter' },
        { kind: 'quest', quest: 'q_letter', stage: 'told' },
      ],
    },
    {
      id: 'yorne.trade',
      when: (c) => c.has('met:yorne'),
      text: 'What is there to drink?',
      reply: 'What is in the barrel. Coin first.',
      effects: [{ kind: 'trade', trader: 'yorne_tavern' }],
    },
    {
      id: 'yorne.rumour_orders',
      when: (c) => c.has('met:yorne') && c.chapter >= 2,
      text: 'The city feels different.',
      reply: 'Three orders recruiting in one week. That has happened twice in my life '
        + 'and both times it was about the mines.',
    },
    // A publican's whole trade is knowing which doors shut behind which people.
    {
      id: 'yorne.closed_watch',
      when: (c) => c.has('quest:q_watch:closed'),
      text: 'Aldric will not look at me.',
      reply: 'He would not. A captain remembers who did not stand in his yard.',
      once: true,
    },
    {
      id: 'yorne.closed_ember',
      when: (c) => c.has('quest:q_ember:closed'),
      text: 'The Chapter turned me back down the road.',
      reply: 'They are patient with everyone except the people who chose otherwise. '
        + 'Do not go up there again.',
      once: true,
    },
    {
      id: 'yorne.closed_freeblade',
      when: (c) => c.has('quest:q_freeblade:closed'),
      text: 'Sarn spat when he saw me.',
      reply: 'Then stay off the outer farms after dark. That is not advice, it is arithmetic.',
      once: true,
    },
    {
      id: 'yorne.bribe_heard',
      when: (c) => c.has('watch:bribed'),
      text: 'Say nothing about the gate.',
      reply: 'I say nothing about anything. — He is already pouring. — Though I would not '
        + 'do it twice with the same man.',
      once: true,
    },
    { id: 'yorne.leave', text: 'Later.', reply: 'It will still be here.', ends: true, priority: -100 },
  ],

  // --- Vessa, the alchemist in the upper quarter -----------------------------
  vessa_alchemist: [
    {
      id: 'vessa.deliver',
      when: (c) => c.has('quest:q_letter:carried'),
      text: 'Yorne sent this.',
      reply: 'Unbroken. That is rarer than you would think. Here — and if you want work, '
        + 'I want a wolf\'s heart and I do not want to know how you got it.',
      once: true, priority: 120,
      effects: [
        { kind: 'take', item: 'sealed_letter' },
        { kind: 'gold', amount: 120 },
        { kind: 'xp', amount: 200 },
        { kind: 'quest', quest: 'q_letter', stage: 'done' },
        { kind: 'flag', flag: 'met:vessa' },
      ],
    },
    {
      id: 'vessa.greet',
      text: 'You are the alchemist.',
      reply: 'I am the only one who will sell you anything that works. What do you want?',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:vessa' }],
    },
    // She notices which of the four ways you took. Somebody in the upper quarter
    // always does.
    {
      id: 'vessa.saw_errand',
      when: (c) => c.has('met:vessa') && c.has('quest:q_upper:errand'),
      text: 'The guards let me through with your post.',
      reply: 'They always do. It is the one thing in this city that works.',
      once: true,
    },
    {
      id: 'vessa.saw_bribed',
      when: (c) => c.has('met:vessa') && c.has('quest:q_upper:bribed'),
      text: 'Getting up here cost me three hundred coin.',
      reply: 'Then you overpaid. Two hundred is the rate and he knows it.',
      once: true,
    },
    {
      id: 'vessa.saw_sworn',
      when: (c) => c.has('met:vessa') && c.has('quest:q_upper:sworn'),
      text: 'They let me through on the oath.',
      reply: 'Of course they did. That is what an oath is for, and it is why so few '
        + 'people read the rest of it.',
      once: true,
    },
    {
      id: 'vessa.trade',
      when: (c) => c.has('met:vessa'),
      text: 'What have you got?',
      reply: 'Draughts. Some of them are even honest.',
      effects: [{ kind: 'trade', trader: 'vessa_alchemist' }],
    },
    {
      id: 'vessa.alchemy_ask',
      when: (c) => c.has('met:vessa') && !c.knows('alchemy'),
      text: 'Teach me to make them.',
      reply: 'Two hundred and fifty, and you will burn your hands before you get it right.',
      once: true,
      effects: [{ kind: 'flag', flag: 'vessa:offered' }],
    },
    {
      id: 'vessa.alchemy',
      when: (c) => c.has('vessa:offered') && c.gold >= 250 && !c.knows('alchemy'),
      text: 'Here is the two hundred and fifty.',
      reply: 'Heat, then the root, then the water. Never the other way round.',
      effects: [
        { kind: 'gold', amount: -250 },
        { kind: 'trainer', skill: 'alchemy', free: false },
      ],
    },
    {
      id: 'vessa.ore',
      when: (c) => c.has('met:vessa') && c.has('knows:ore_theft'),
      text: 'Somebody is stealing ore off the farm road.',
      reply: 'Somebody is stealing it off the *ships*, which is a different order of nerve. '
        + 'Ask the man on the plateau what it is for. He writes to the governor about it weekly '
        + 'and nobody reads him.',
      once: true,
      effects: [{ kind: 'flag', flag: 'knows:ossric' }],
    },
    { id: 'vessa.leave', text: 'Thank you.', reply: 'Mind the door.', ends: true, priority: -100 },
  ],

  // --- Captain Aldric: the Watch ---------------------------------------------
  aldric_captain: [
    {
      id: 'aldric.greet',
      text: 'You command the Watch.',
      reply: 'I command what is left of it. Say what you want.',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:aldric' }],
    },
    {
      id: 'aldric.join_ask',
      when: (c) => c.has('met:aldric') && !c.guild,
      text: 'I want to serve.',
      reply: 'Everybody does, when they are hungry. I take men who can be vouched for '
        + 'and who can fight. Bring me both and we will talk.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_watch', stage: 'told' }],
    },
    {
      id: 'aldric.vouched',
      when: (c) => c.has('quest:q_watch:told') && c.has('harl:trusts') && !c.guild,
      text: 'Harl the smith will speak for me. The ore was bandits, and I proved it.',
      reply: 'Harl does not speak for people. That is worth more than the ore was. '
        + 'Now show me you can hold a blade — I will not have another corpse in my yard.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_watch', stage: 'vouched' }],
    },
    {
      id: 'aldric.join',
      when: (c) => c.has('quest:q_watch:vouched') && c.skill('oneHanded') >= 20 && !c.guild,
      text: 'Twenty per cent of a swordsman, and getting better.',
      reply: 'Then you are one of mine. Understand what that means: the Chapter will not '
        + 'take you now, and the Freeblades will spit when they hear your name.',
      once: true,
      effects: [
        { kind: 'guild', guild: 'watch' },
        { kind: 'xp', amount: 500 },
        { kind: 'quest', quest: 'q_watch', stage: 'done' },
        { kind: 'give', item: 'watch_mail' },
      ],
    },
    {
      id: 'aldric.join_unready',
      when: (c) => c.has('quest:q_watch:vouched') && c.skill('oneHanded') < 20 && !c.guild,
      text: 'I am ready.',
      reply: 'You are not. Twenty per cent of a swordsman, at least. Harl teaches for coin.',
    },
    {
      id: 'aldric.train_ask',
      when: (c) => c.guild === 'watch' && !c.has('aldric:offered'),
      text: 'Teach me what the Watch knows.',
      reply: 'Strength first. Everything else follows it.',
      once: true,
      effects: [{ kind: 'flag', flag: 'aldric:offered' }],
    },
    {
      id: 'aldric.train',
      when: (c) => c.has('aldric:offered'),
      text: 'Then teach me.',
      reply: 'Again. And again. And do not drop the shoulder.',
      effects: [{ kind: 'trainer', skill: 'oneHanded', max: 75, step: 5 }],
    },
    {
      id: 'aldric.lighthouse',
      when: (c) => c.guild === 'watch' && c.chapter >= 3 && !c.has('quest:q_lighthouse:told'),
      text: 'What needs doing?',
      reply: 'The light on the west headland. They have stopped robbing and started '
        + 'organising, and organised men on a coast means ships. End it.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_lighthouse', stage: 'told' }],
    },
    {
      id: 'aldric.other_guild',
      when: (c) => !!c.guild && c.guild !== 'watch',
      text: 'I have taken another oath.',
      reply: 'Then we have nothing to discuss.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_watch', stage: 'closed' }],
    },
    { id: 'aldric.leave', text: 'Captain.', reply: 'Move along.', ends: true, priority: -100 },
  ],

  // --- Brother Kelm: the Ember Chapter ----------------------------------------
  kelm_chapter: [
    {
      id: 'kelm.greet',
      text: 'You keep this house?',
      reply: 'The fire keeps it. I sweep the floor. What brings a man up the temple road?',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:kelm' }],
    },
    {
      id: 'kelm.join_ask',
      when: (c) => c.has('met:kelm') && !c.guild,
      text: 'I want what you know.',
      reply: 'Everyone wants it and almost nobody keeps it. A novice brings a gift of five '
        + 'hundred coin and answers three questions honestly. The coin is the easy half.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_ember', stage: 'told' }],
    },
    {
      id: 'kelm.test',
      when: (c) => c.has('quest:q_ember:told') && !c.guild,
      text: 'Ask your three questions.',
      reply: 'Why do you want it. — Money. Who would you burn. — Nobody yet. What would you '
        + 'do if the fire said no. — Ask again tomorrow. — Two of those were honest, which '
        + 'is two more than most.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_ember', stage: 'tested' }, { kind: 'xp', amount: 150 }],
    },
    {
      id: 'kelm.join',
      when: (c) => c.has('quest:q_ember:tested') && c.gold >= 500 && !c.guild,
      text: 'Five hundred coin. Take it.',
      reply: 'Then you are a novice, and you will find the Watch closes its yard to you '
        + 'and the Freeblades close everything else.',
      once: true,
      effects: [
        { kind: 'gold', amount: -500 },
        { kind: 'guild', guild: 'ember' },
        { kind: 'xp', amount: 500 },
        { kind: 'quest', quest: 'q_ember', stage: 'done' },
        { kind: 'give', item: 'ember_robe' },
      ],
    },
    {
      id: 'kelm.join_poor',
      when: (c) => c.has('quest:q_ember:tested') && c.gold < 500 && !c.guild,
      text: 'I will have the five hundred.',
      reply: 'The fire is patient. I am less so.',
    },
    {
      id: 'kelm.train_ask',
      when: (c) => c.guild === 'ember' && !c.has('kelm:offered'),
      text: 'Teach me.',
      reply: 'Mana before magic. A man who reaches past his mana burns his hands off.',
      once: true,
      effects: [{ kind: 'flag', flag: 'kelm:offered' }],
    },
    {
      id: 'kelm.train',
      when: (c) => c.has('kelm:offered'),
      text: 'Then let us begin.',
      reply: 'Breathe. Then look at the coal, not the flame.',
      effects: [{ kind: 'trainer', skill: 'alchemy', free: false }],
    },
    {
      id: 'kelm.ossric',
      when: (c) => c.guild === 'ember' && c.chapter >= 2 && !c.has('quest:q_tower:told'),
      text: 'What does the Chapter want of me?',
      reply: 'There is a man on the plateau who has written to us eleven times about the ore. '
        + 'We stopped reading at four. Go and find out which of us was the fool.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_tower', stage: 'told' }],
    },
    {
      id: 'kelm.other_guild',
      when: (c) => !!c.guild && c.guild !== 'ember',
      text: 'I have taken another oath.',
      reply: 'Then walk back down the road you came up.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_ember', stage: 'closed' }],
    },
    { id: 'kelm.leave', text: 'Brother.', reply: 'Go carefully.', ends: true, priority: -100 },
  ],

  // --- Sarn: the Freeblades ----------------------------------------------------
  sarn_freeblade: [
    {
      id: 'sarn.greet',
      text: 'You are not a farmer.',
      reply: 'No. The farmer pays us and we make sure he keeps the farm. Ask your question.',
      once: true, priority: 100,
      effects: [{ kind: 'flag', flag: 'met:sarn' }],
    },
    {
      id: 'sarn.join_ask',
      when: (c) => c.has('met:sarn') && !c.guild,
      text: 'How does a man ride with you?',
      reply: 'He kills things in front of me until I am bored of watching. '
        + 'Four wolves would do it. The wood is full of them.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_freeblade', stage: 'told' }],
    },
    {
      id: 'sarn.proven',
      when: (c) => c.has('quest:q_freeblade:told') && c.has('quest:q_wolves:cleared') && !c.guild,
      text: 'Four wolves, by the mill.',
      reply: 'Bosk told me before you did. Sit down — and know that the city will not have '
        + 'you after this, gate or no gate.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_freeblade', stage: 'proven' }],
    },
    {
      id: 'sarn.join',
      when: (c) => c.has('quest:q_freeblade:proven') && !c.guild,
      text: 'Then I ride with you.',
      reply: 'You do. We take what we are owed and nothing else, and that is the whole of the law here.',
      once: true,
      effects: [
        { kind: 'guild', guild: 'freeblade' },
        { kind: 'xp', amount: 500 },
        { kind: 'quest', quest: 'q_freeblade', stage: 'done' },
        { kind: 'give', item: 'freeblade_harness' },
      ],
    },
    {
      id: 'sarn.train_ask',
      when: (c) => c.guild === 'freeblade' && !c.has('sarn:offered'),
      text: 'Teach me what you do.',
      reply: 'Two hands. A man with a shield is a man waiting to lose.',
      once: true,
      effects: [{ kind: 'flag', flag: 'sarn:offered' }],
    },
    {
      id: 'sarn.train',
      when: (c) => c.has('sarn:offered'),
      text: 'Show me.',
      reply: 'Swing through it. Never at it.',
      effects: [{ kind: 'trainer', skill: 'twoHanded', max: 70, step: 5 }],
    },
    {
      id: 'sarn.ossric',
      when: (c) => c.guild === 'freeblade' && c.chapter >= 2 && !c.has('quest:q_tower:told'),
      text: 'What is worth doing?',
      reply: 'The ore. Somebody is moving it east and it is not the guild that owns it. '
        + 'There is a man on the plateau who knows where it goes.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_tower', stage: 'told' }],
    },
    {
      id: 'sarn.other_guild',
      when: (c) => !!c.guild && c.guild !== 'freeblade',
      text: 'I have taken another oath.',
      reply: '— He spits, and goes back to what he was doing.',
      once: true,
      effects: [{ kind: 'quest', quest: 'q_freeblade', stage: 'closed' }],
    },
    { id: 'sarn.leave', text: 'Enough.', reply: 'Off you go.', ends: true, priority: -100 },
  ],

  // --- Ossric, on the plateau: the plot ---------------------------------------
  ossric_tower: [
    {
      id: 'ossric.greet',
      when: (c) => c.has('knows:ossric') || c.has('quest:q_tower:told'),
      text: 'You are the one who writes to the city.',
      reply: 'Eleven times. Nobody reads them. You walked up here, so you are already '
        + 'more use than the governor.',
      once: true, priority: 100,
      effects: [
        { kind: 'flag', flag: 'met:ossric' },
        { kind: 'quest', quest: 'q_tower', stage: 'met' },
      ],
    },
    {
      id: 'ossric.what',
      when: (c) => c.has('met:ossric') && c.chapter >= 3,
      text: 'What is the ore for?',
      reply: 'Not coin, and not blades. Somebody is buying more of it than an army could '
        + 'use and shipping it east through a pass that has been shut for forty years. '
        + 'Walk the Cleft and you will see what they cut it open with.',
      once: true,
      effects: [
        { kind: 'quest', quest: 'q_tower', stage: 'done' },
        { kind: 'quest', quest: 'q_cleft', stage: 'told' },
        { kind: 'xp', amount: 600 },
      ],
    },
    {
      id: 'ossric.notyet',
      when: (c) => c.has('met:ossric') && c.chapter < 3,
      text: 'What is the ore for?',
      reply: 'You are not ready to hear it and I am not ready to say it. Come back when '
        + 'your order has told you to ask me.',
    },
    {
      id: 'ossric.stranger',
      when: (c) => !c.has('knows:ossric') && !c.has('quest:q_tower:told') && !c.has('met:ossric'),
      text: 'Who lives up here?',
      reply: 'Somebody who is not expecting you, and who has nothing to say to a man '
        + 'nobody sent. Come back when somebody has.',
      priority: 90,
    },
    { id: 'ossric.leave', text: 'I will come back.', reply: 'They all say that.', ends: true, priority: -100 },
  ],
};

/**
 * Which NPC id speaks which conversation.
 *
 * The numbers are positions in `makePeople` (src/world/world.js) and the first
 * four are load-bearing — the golden-path bot and half the tests find people by
 * them. New speakers go on the end, never in the middle.
 */
export const SPEAKERS = {
  npc0: 'watch_gate',        // the gate of the upper quarter
  npc1: 'bosk_hunter',       // outside the land gate
  npc3: 'harl_smith',        // the smithy, lower quarter
  npc8: 'yorne_tavern',      // the harbour
  npc9: 'aldric_captain',    // the barracks
  npc10: 'vessa_alchemist',  // the upper quarter
  npc11: 'kelm_chapter',     // the monastery
  npc12: 'sarn_freeblade',   // Hulder's farm
  npc13: 'ossric_tower',     // the plateau
};
