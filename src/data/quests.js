// The quest log.
//
// A quest here is a *title, a set of stages and the order they come in*. It is
// not logic: nothing in this file can change the world. The stages are set by
// dialogue effects (`{ kind: 'quest', quest, stage }`) or by `world.checkQuests`
// when something becomes true by being done, and this file exists so that the
// log can say "Find the crates" instead of "q_ore: told".
//
// House rules, enforced by the validator in tools/test.js:
//   · Every stage a conversation or the world can set must appear here.
//   · Every quest ends in `done` or `failed`, and the log says which.
//   · A stage's text is what the player is *going to do next*, not a summary of
//     what they were told. A log entry that reads "you spoke to the smith" is
//     an event; one that reads "Find the crates on the farm road" is a quest.

export const QUESTS = {
  // --- chapter one: the errands that get you known -----------------------------
  q_ore: {
    title: 'The short crates',
    giver: 'Harl the smith',
    chapter: 1,
    stages: {
      told: 'Two crates of ore went missing on the farm road. Find them.',
      found: 'Bandits took them, and left a letter behind. Take it back to Harl.',
      done: 'Harl has his ore, and owes you the word of an honest man.',
    },
    order: ['told', 'found', 'done'],
  },

  q_wolves: {
    title: 'The wood will not let him work',
    giver: 'Bosk the hunter',
    chapter: 1,
    stages: {
      told: 'Bosk cannot hunt for wolves. Thin the pack — four of them.',
      cleared: 'The pack is down. Go and tell him.',
      done: 'Bosk can work again, and pays what he said he would.',
    },
    order: ['told', 'cleared', 'done'],
  },

  // --- the door in the world ---------------------------------------------------
  //
  // Four ways past the upper gate, and the quest tracks whichever one you take.
  // This is the shape of the original's best early quest: not a key, not a
  // cutscene — two guards, a conversation, and several honest answers.
  q_upper: {
    title: 'The upper quarter',
    giver: 'the gate of the upper quarter',
    chapter: 1,
    stages: {
      refused: 'The guards will not let you up. There will be a way.',
      errand: 'Yorne at the tavern has a sealed letter for the alchemist. '
        + 'A man carrying somebody else\'s business is a man with business.',
      bribed: 'You paid to walk up your own city\'s street.',
      sworn: 'An oath got you through the gate. It cost you two other lives.',
      climbed: 'You went over the wall by the stacked crates. Nobody saw.',
      done: 'You may walk in the upper quarter.',
    },
    order: ['refused', 'errand', 'bribed', 'sworn', 'climbed', 'done'],
    // Any of these four ends it, which is the point of it.
    ends: ['errand', 'bribed', 'sworn', 'climbed'],
  },

  q_letter: {
    title: 'Yorne\'s letter',
    giver: 'Yorne, who keeps the tavern',
    chapter: 1,
    stages: {
      told: 'Carry Yorne\'s sealed letter to Vessa the alchemist, in the upper quarter.',
      carried: 'You have the letter. The gate is the problem.',
      done: 'Vessa has her letter, and the gate guards have seen you carry it.',
    },
    order: ['told', 'carried', 'done'],
  },

  // --- the three oaths ---------------------------------------------------------
  //
  // One quest each, all three open at once, and taking any of them shuts the
  // other two for the rest of the game (pillar P5). The log keeps the two you
  // did not take at `closed` rather than deleting them, because a player should
  // be able to see the road they did not walk.
  q_watch: {
    title: 'The Watch',
    giver: 'Captain Aldric, in the barracks',
    chapter: 1,
    guild: 'watch',
    stages: {
      told: 'Aldric takes men who can be vouched for and can fight. Get both.',
      vouched: 'Someone in the city will speak for you. Now stand in the yard.',
      done: 'You are sworn to the Watch.',
      closed: 'You took another oath. The Watch has no use for you.',
    },
    order: ['told', 'vouched', 'done', 'closed'],
  },

  q_ember: {
    title: 'The Ember Chapter',
    giver: 'Brother Kelm, at the monastery',
    chapter: 1,
    guild: 'ember',
    stages: {
      told: 'The Chapter takes novices who bring a gift and a clear head. '
        + 'Five hundred coin, and answer the three questions.',
      tested: 'You answered. Bring the gift.',
      done: 'You are a novice of the Ember Chapter.',
      closed: 'You took another oath. The Chapter\'s door is shut.',
    },
    order: ['told', 'tested', 'done', 'closed'],
  },

  q_freeblade: {
    title: 'The Freeblades',
    giver: 'Sarn, at Hulder\'s farm',
    chapter: 1,
    guild: 'freeblade',
    stages: {
      told: 'The Freeblades hold the outer farms and answer to nobody. '
        + 'Sarn wants to see you fight before he talks about oaths.',
      proven: 'You fought. Sarn will talk now.',
      done: 'You ride with the Freeblades.',
      closed: 'You took another oath. Sarn spits when your name comes up.',
    },
    order: ['told', 'proven', 'done', 'closed'],
  },

  // --- the road east -----------------------------------------------------------
  q_tower: {
    title: 'The man on the plateau',
    giver: 'whichever order you swore to',
    chapter: 2,
    stages: {
      told: 'Ossric has been writing to the city about the ore. Go and ask him why.',
      met: 'Ossric will answer when the Cleft is open and not before.',
      done: 'You know what the ore is for. It is worse than theft.',
    },
    order: ['told', 'met', 'done'],
  },

  q_cleft: {
    title: 'The road east',
    giver: 'Ossric',
    chapter: 3,
    stages: {
      told: 'The Cleft is passable now. Walk it, and see what walks back.',
      done: 'The pass is yours. The valley is not.',
    },
    order: ['told', 'done'],
  },

  // --- past the pass -----------------------------------------------------------
  q_convoy: {
    title: 'Where the ore goes',
    giver: 'Brant, at the camp',
    chapter: 3,
    stages: {
      told: 'The pits are still being worked and the ore is still leaving. '
        + 'Nobody at the camp is being paid for either. Find out who is taking it.',
      counted: 'Hask has counted the loads. They go east, to the keep, and they '
        + 'do not come back out.',
      done: 'You know who is behind the keep\'s wall, and what they are paying with.',
    },
    order: ['told', 'counted', 'done'],
  },

  q_keep: {
    title: 'The keep',
    giver: 'Brant, at the camp',
    chapter: 4,
    stages: {
      told: 'The keep is shut and the men who shut it have not opened it in a year.',
      opened: 'The gate is open. Whatever is inside knows you are coming.',
      done: 'The keep is yours. So is what it was hiding.',
    },
    order: ['told', 'opened', 'done'],
  },

  q_shrine: {
    title: 'The nine stones',
    giver: 'Ulla, at the shrine',
    chapter: 3,
    stages: {
      told: 'Ulla keeps a fire that has not been lit since the mine failed. '
        + 'She wants ore from all three pits to light it again.',
      gathered: 'Three loads of blackore, one from each pit. Take them to her.',
      done: 'The fire is lit. Something in the valley noticed.',
    },
    order: ['told', 'gathered', 'done'],
  },

  // --- what each order actually asks of you -------------------------------------
  //
  // Joining is not the content; being *used* is. Each order sends you to the
  // same three places for different reasons, which is the cheapest way to make
  // one map into three games — and the reason the guild you pick has to close
  // two doors to mean anything.
  q_order_watch: {
    title: 'The captain\'s orders',
    giver: 'Captain Aldric',
    chapter: 2,
    guild: 'watch',
    stages: {
      told: 'The Watch counts ore at the gate and not at the water. '
        + 'Aldric wants to know who arranged that.',
      quay: 'A porter says the count was moved by somebody who can tell the Watch '
        + 'where to stand. Four men in the city can. All four live up the hill.',
      done: 'Aldric has his answer, and does not thank you for it.',
    },
    order: ['told', 'quay', 'done'],
  },

  q_order_ember: {
    title: 'What the Chapter is afraid of',
    giver: 'Brother Kelm',
    chapter: 2,
    guild: 'ember',
    stages: {
      told: 'The Chapter has been reading the ore shipments for a year and does not '
        + 'like the arithmetic. Kelm wants a witness who is not a priest.',
      shrine: 'There is a fire in the valley that was lit every evening for nine '
        + 'years and has not been lit since. Light it, and tell him what happens.',
      done: 'Kelm knows what you saw. He was hoping to be wrong.',
    },
    order: ['told', 'shrine', 'done'],
  },

  q_order_freeblade: {
    title: 'Sarn\'s arithmetic',
    giver: 'Sarn',
    chapter: 2,
    guild: 'freeblade',
    stages: {
      told: 'Somebody is moving more ore than an army could use and paying nobody '
        + 'for it. Sarn wants to know what is at the other end, and how much of it '
        + 'there is.',
      counted: 'Forty-one loads east, none back. Whatever is behind the keep\'s wall '
        + 'has a year of blackore in it.',
      done: 'Sarn has his number. He is already deciding what to do about it.',
    },
    order: ['told', 'counted', 'done'],
  },

  q_lighthouse: {
    title: 'The light on the headland',
    giver: 'Captain Aldric',
    chapter: 3,
    stages: {
      told: 'The bandits at the lighthouse have stopped robbing and started organising. '
        + 'End it.',
      done: 'The headland is quiet.',
    },
    order: ['told', 'done'],
  },
};

/** What a quest looks like in the log right now. */
export function entry(id, stage) {
  const q = QUESTS[id];
  if (!q) return null;
  const finished = stage === 'done' || stage === 'closed' || stage === 'failed';
  return {
    id, title: q.title, giver: q.giver, stage,
    text: q.stages[stage] || stage,
    finished,
    // How far along, for a log that wants to sort or show a bar.
    step: q.order.indexOf(stage) + 1,
    steps: q.order.length,
  };
}

/** Every stage any quest can be in — the validator checks nothing else is set. */
export const ALL_STAGES = Object.entries(QUESTS)
  .flatMap(([id, q]) => q.order.map((s) => `${id}:${s}`));
